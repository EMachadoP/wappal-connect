import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isEmployeeSender } from "../_shared/is-employee.ts";
import { parseAndExtract } from "../_shared/parse-extract.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- HELPERS ---

function isOperationalIssue(text: string) {
  return /(câmera|camera|cftv|dvr|gravador|nvr|port[aã]o|motor|cerca|interfone|controle de acesso|catraca|fechadura|tv coletiva|antena|acesso remoto|sem imagem|sem sinal|travado|n[aã]o abre|n[aã]o fecha|parou|quebrado|defeito)/i.test(text);
}

function looksLikeApartment(text: string) {
  return /^\s*\d{1,6}[A-Za-z]?\s*$/.test(text.trim());
}

function buildSummaryFromRecentUserMessages(msgs: { role: string; content: string }[], max = 3) {
  const users = msgs.filter(m => m.role === 'user').slice(-max).map(m => m.content);
  return users.join(' | ').slice(0, 500);
}

function getLastByRole(msgs: { role: string; content: string }[], role: string) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === role) return msgs[i];
  }
  return null;
}

/**
 * Executes the create-protocol edge function
 */
async function executeCreateProtocol(
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string,
  conversationId: string,
  participantId: string | undefined,
  args: any
) {
  // Validate conversation_id first
  if (!conversationId) {
    console.error('[TICKET] executeCreateProtocol called with empty conversationId');
    throw new Error('conversation_id is required');
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(conversationId)) {
    console.error('[TICKET] Invalid conversation_id format:', conversationId);
    throw new Error(`Invalid conversation_id format: ${conversationId}`);
  }

  console.log('[TICKET] Starting protocol creation for conversation:', conversationId);

  // 1. Deep Condominium Lookup (Critical for Asana/G7)
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('contact_id, active_condominium_id, contacts(name)')
    .eq('id', conversationId)
    .single();

  if (convError) {
    console.error('[TICKET] Failed to fetch conversation:', convError);
    throw new Error(`Failed to fetch conversation: ${convError.message}`);
  }

  if (!conv) {
    console.error('[TICKET] Conversation not found:', conversationId);
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  let condominiumId = conv?.active_condominium_id;

  if (!condominiumId) {
    const { data: part } = await supabase
      .from('conversation_participants')
      .select('entity_id')
      .eq('conversation_id', conversationId)
      .not('entity_id', 'is', null)
      .limit(1)
      .single();
    if (part) condominiumId = part.entity_id;
  }

  const bodyObj = {
    conversation_id: conversationId,
    condominium_id: condominiumId,
    participant_id: participantId, // Pass participant_id for better condominium resolution
    summary: args.summary,
    priority: args.priority || 'normal',
    category: args.category || 'operational',
    requester_name: args.requester_name || (conv?.contacts as any)?.name || 'Não informado',
    requester_role: args.requester_role || 'Morador',
    apartment: args.apartment,
    notify_group: true // IMPORTANT: Triggers WhatsApp + Asana
  };

  console.log('[TICKET] Calling create-protocol with body:', bodyObj);

  const response = await fetch(`${supabaseUrl}/functions/v1/create-protocol`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'apikey': supabaseServiceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyObj)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[TICKET] create-protocol failed with status:', response.status);
    console.error('[TICKET] Error response:', errorText);
    console.error('[TICKET] Payload sent:', JSON.stringify(bodyObj, null, 2));
    throw new Error(`Create protocol failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log('[TICKET] create-protocol SUCCESS:', result);
  return result;
}

// --- SERVE ---

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const rawBody = await req.json();
    const messages = (rawBody.messages || []).slice(0, 50); // Limit to 50
    const conversationIdRaw = rawBody.conversation_id || rawBody.conversationId || rawBody.conversation?.id;
    const conversationId = (typeof conversationIdRaw === 'string') ? conversationIdRaw : undefined;
    const participant_id = rawBody.participant_id; // Extract participant_id from request

    // Dynamically clean passed systemPrompt from negative examples (mimicry prevention)
    let basePrompt = rawBody.systemPrompt || "";
    basePrompt = basePrompt.split(/EXEMPLO ERRADO|EXEMPLO DE ERRO|MIMETISMO/i)[0].trim();

    const messagesNoSystem = messages.filter((m: any) => m.role !== 'system');

    // Get last user message and recent context
    const lastUserMsg = getLastByRole(messagesNoSystem, 'user');
    const lastUserMsgText = (lastUserMsg?.content || "").trim();
    const recentText = messagesNoSystem.slice(-6).map((m: any) => m.content).join(" ");

    // --- EMPLOYEE DETECTION & STRUCTURED EXTRACTION ---
    // Load the last message's raw_payload for employee detection
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('id, content, transcript, raw_payload')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const rawPayload = lastMsg?.raw_payload ?? {};
    const employee = await isEmployeeSender(supabase, rawPayload);
    const isEmployee = employee.isEmployee;

    // Use transcript if available (audio messages), otherwise content
    const textForExtraction = (lastMsg?.transcript ?? lastMsg?.content ?? lastUserMsgText).replace(/^🎤\s*/, '').trim();

    // Check for employee command patterns
    const hasCommand = /^CRIAR\s+AGENDAMENTO\b|^ABRIR\s+CHAMADO\b|^ABRIR\s+PROTOCOLO\b|^CHAMADO\s*:|^AGENDA\s*:/i.test(textForExtraction);

    // If employee WITHOUT command → skip AI response (just register the message)
    if (isEmployee && !hasCommand) {
      console.log('[AI] Employee message without command, skipping AI response.');
      return new Response(JSON.stringify({
        text: null,
        skipped: 'employee_no_command',
        finish_reason: 'SKIPPED',
        provider: 'employee-detection',
        model: 'none',
        request_id: crypto.randomUUID()
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // If employee WITH command → structured extraction
    if (isEmployee && hasCommand && conversationId) {
      console.log('[AI] Employee command detected, extracting structured data...');

      // Load known condominiums to help extraction
      const { data: condos } = await supabase.from('condominiums').select('name').limit(500);
      const knownCondominiums = (condos ?? []).map((c: any) => c.name).filter(Boolean);

      const extracted = await parseAndExtract(null, {
        text: textForExtraction,
        isEmployee: true,
        knownCondominiums
      });

      if (extracted.intent === 'create_schedule' || extracted.intent === 'create_protocol') {
        // If missing required fields, ask for them
        if (extracted.draft && extracted.missing_fields.length > 0) {
          const missing = extracted.missing_fields[0];
          let question = '';
          if (missing === 'condominium_name') question = 'Qual é o condomínio?';
          else if (missing === 'category') question = 'Qual é o tipo do serviço? (Portão, CFTV, Interfone, TV Coletiva)';
          else if (missing === 'summary') question = 'Descreva em uma frase o problema a ser atendido.';
          else question = `Por favor, informe: ${missing}`;

          return new Response(JSON.stringify({
            text: `📋 Entendido, ${employee.profileName}. ${question}`,
            finish_reason: 'NEED_EMPLOYEE_INPUT',
            provider: 'employee-extraction',
            model: 'parse-extract',
            request_id: crypto.randomUUID(),
            extracted
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // All data available - create the protocol
        try {
          const ticketData = await executeCreateProtocol(supabase, supabaseUrl, supabaseServiceKey, conversationId, participant_id, {
            summary: extracted.fields.summary || 'Agendamento solicitado via funcionário',
            priority: extracted.fields.urgency === 'high' ? 'critical' : 'normal',
            category: extracted.fields.category || 'operational',
            requester_name: `G7 Serv (${employee.profileName})`,
            requester_role: 'Funcionário',
          });

          const protocolCode = ticketData.protocol?.protocol_code || ticketData.protocol_code;
          return new Response(JSON.stringify({
            text: `✅ Pronto, ${employee.profileName}! Protocolo **${protocolCode}** criado com sucesso.\n\n📍 ${extracted.fields.condominium_name || 'Condomínio não especificado'}\n🔧 ${extracted.fields.category || 'Categoria não especificada'}\n📝 ${extracted.fields.summary}`,
            finish_reason: 'EMPLOYEE_PROTOCOL_CREATED',
            provider: 'employee-extraction',
            model: 'parse-extract',
            request_id: crypto.randomUUID()
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } catch (e) {
          console.error('[AI] Employee protocol creation failed:', e);
          // Fall through to normal flow
        }
      }
    }

    // --- TIER 4: DETERMINISTIC (Bulletproof Context-Aware) ---
    const { data: convData } = await supabase
      .from('conversations')
      .select('active_condominium_id')
      .eq('id', conversationId)
      .maybeSingle();

    const hasIdentifiedCondo = Boolean(convData?.active_condominium_id);

    const lastIssueMsg = [...messagesNoSystem].reverse().find(m => m.role === 'user' && isOperationalIssue(m.content));
    const hasOperationalContext = isOperationalIssue(recentText);
    const aptCandidate = [...messagesNoSystem]
      .reverse()
      .find(m => m.role === "user" && looksLikeApartment(m.content))
      ?.content.trim();

    const isProvidingApartment = looksLikeApartment(lastUserMsgText) && hasOperationalContext;
    const needsApartment = /(interfone|tv|controle|apartamento|apto|unidade)/i.test(recentText);
    const canOpenNow = hasIdentifiedCondo && hasOperationalContext && (!needsApartment || Boolean(aptCandidate));

    if (!hasIdentifiedCondo && hasOperationalContext && conversationId) {
      console.log('[TICKET] Deterministic block: Missing condominium identification.');
      return new Response(JSON.stringify({
        text: "Para que eu possa abrir o chamado corretamente, poderia me confirmar qual é o seu condomínio?",
        finish_reason: 'NEED_CONDO_IDENTIFICATION',
        provider: 'deterministic',
        model: 'keyword-detection',
        request_id: crypto.randomUUID()
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (conversationId && (canOpenNow || isProvidingApartment)) {
      if (needsApartment && !aptCandidate) {
        console.log('[TICKET] Deterministic block: Need apartment for issue:', lastIssueMsg?.content);
        return new Response(JSON.stringify({
          text: "Entendido. Para eu abrir o protocolo agora mesmo, me confirme por favor o número do seu apartamento.",
          finish_reason: 'NEED_APARTMENT',
          provider: 'deterministic',
          model: 'keyword-detection',
          request_id: crypto.randomUUID()
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      try {
        const ticketData = await executeCreateProtocol(supabase, supabaseUrl, supabaseServiceKey, conversationId, {
          summary: (lastIssueMsg?.content || lastUserMsgText).slice(0, 500),
          priority: /travado|urgente|urgência|emergência/i.test(recentText) ? 'critical' : 'normal',
          apartment: aptCandidate
        });

        const protocolCode = ticketData.protocol?.protocol_code || ticketData.protocol_code;
        return new Response(JSON.stringify({
          text: `Certo. Já registrei o chamado sob o protocolo **${protocolCode}** e encaminhei para a equipe operacional. Vamos dar sequência por aqui.`,
          finish_reason: 'DETERMINISTIC_SUCCESS',
          provider: 'deterministic',
          model: 'keyword-detection',
          request_id: crypto.randomUUID()
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e) {
        console.error("Deterministic opening failed, falling back to LLM...", e);
      }
    }

    // --- TIER 5: IA (LLM) ---

    // Final Prompt Reinforcement
    const cleanPrompt = `${basePrompt}

Sua personalidade é Ana Mônica, assistente da G7.
Sua única função é ajudar com problemas técnicos de condomínio.
Para registrar um problema, use SEMPRE a ferramenta 'create_protocol' IMEDIATAMENTE.
NUNCA diga que registrou o protocolo sem chamar a ferramenta.
NUNCA invente preços ou prazos.`;

    const { data: providerConfig } = await supabase
      .from('ai_provider_configs')
      .select('*')
      .eq('active', true)
      .limit(1)
      .single();

    if (!providerConfig) throw new Error('Nenhum provedor de IA ativo configurado');
    const provider = providerConfig as any;

    const apiKey = Deno.env.get(provider.key_ref || (provider.provider === 'lovable' ? 'LOVABLE_API_KEY' : ''));
    if (!apiKey) throw new Error(`Chave de API não encontrada para ${provider.provider}`);

    // Tool definition (using create_protocol as name to avoid confusion)
    const protocolTool = [{
      type: "function",
      function: {
        name: "create_protocol",
        description: "Registra tecnicamente um problema de condomínio para a equipe operacional.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "O problema detalhado" },
            priority: { type: "string", enum: ["normal", "critical"] },
            apartment: { type: "string", description: "Apartamento (se souber)" }
          },
          required: ["summary"]
        }
      }
    }];

    let response: Response;
    if (provider.provider === 'lovable' || provider.provider === 'openai') {
      response = await fetch(
        provider.provider === 'lovable' ? 'https://ai.gateway.lovable.dev/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: 'system', content: cleanPrompt }, ...messagesNoSystem],
            tools: protocolTool,
            tool_choice: 'auto',
            temperature: Number(provider.temperature) || 0.7
          })
        }
      );
    } else if (provider.provider === 'gemini') {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${apiKey}`;
      response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: cleanPrompt }] },
          contents: messagesNoSystem.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          tools: [{ functionDeclarations: [protocolTool[0].function] }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: { temperature: Number(provider.temperature) || 0.7 }
        })
      });
    } else { throw new Error(`Provedor não suportado: ${provider.provider}`); }

    if (!response.ok) throw new Error(`Erro da API de IA: ${await response.text()}`);
    const responseData = await response.json();

    let generatedText = '';
    let functionCall: any = null;
    let tokensIn = 0;
    let tokensOut = 0;

    if (provider.provider === 'gemini') {
      const candidate = responseData.candidates?.[0];
      const part = candidate?.content?.parts?.find((p: any) => p.functionCall);
      if (part) {
        functionCall = { name: part.functionCall.name, args: part.functionCall.args };
      } else {
        generatedText = candidate?.content?.parts?.[0]?.text || '';
      }
      tokensIn = responseData.usageMetadata?.promptTokenCount || 0;
      tokensOut = responseData.usageMetadata?.candidatesTokenCount || 0;
    } else {
      const msg = responseData.choices?.[0]?.message;
      if (msg?.tool_calls?.length) {
        functionCall = {
          name: msg.tool_calls[0].function.name,
          args: JSON.parse(msg.tool_calls[0].function.arguments)
        };
      } else {
        generatedText = msg?.content || '';
      }
      tokensIn = responseData.usage?.prompt_tokens || 0;
      tokensOut = responseData.usage?.completion_tokens || 0;
    }

    // --- FALLBACK INTENT DETECTION ---
    const aiSaidWillRegister = /vou registrar|vou abrir|vou encaminhar|registrei/i.test(generatedText);
    if (!functionCall && aiSaidWillRegister) {
      console.warn('FALLBACK: Intent detected. Forcing protocol creation...');
      functionCall = {
        name: 'create_protocol',
        args: {
          summary: (lastIssueMsg?.content || buildSummaryFromRecentUserMessages(messagesNoSystem)).slice(0, 500),
          priority: /travado|urgente|urgência|emergência/i.test(recentText) ? 'critical' : 'normal',
          apartment: aptCandidate
        }
      };
    }

    // Implementation of Tool call (if triggered by AI or Fallback)
    if (functionCall && (functionCall.name === 'create_protocol' || functionCall.name === 'create_ticket')) {
      try {
        const ticketData = await executeCreateProtocol(supabase, supabaseUrl, supabaseServiceKey, conversationId!, participant_id, functionCall.args);
        const protocolCode = ticketData.protocol?.protocol_code || ticketData.protocol_code;
        generatedText = `Certo. Já registrei o chamado sob o protocolo **${protocolCode}** e encaminhei para a equipe operacional. Vamos dar sequência por aqui.`;
      } catch (e) {
        console.error('Tool call failed:', e);
        console.error('Tool call error details:', {
          conversationId,
          functionCall,
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined
        });
        // Improved fallback message - don't ask for name if we already have participant info
        generatedText = "Puxa, tive um probleminha técnico ao tentar abrir o protocolo automaticamente agora. Mas não se preocupe, eu já anotei tudo e vou passar agora mesmo para a equipe manual. Eles vão entrar em contato em breve!";
      }
    }

    return new Response(JSON.stringify({
      text: generatedText,
      provider: provider.provider,
      model: provider.model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: Date.now() - startTime,
      request_id: crypto.randomUUID()
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('AI Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
