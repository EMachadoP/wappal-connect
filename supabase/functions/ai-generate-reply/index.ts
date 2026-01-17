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

// ✅ FIX: Extract apartment from "apt 1901" / "apto 1901" / "1901"
function extractApartment(text: string): string | null {
  const t = (text || "").trim();

  // "apto 1901" / "apt 1901" / "apartamento: 1901" / "unidade 1901"
  const m1 = t.match(/(?:\bapto\b|\bapt\.?\b|\bapartamento\b|\bunidade\b)\s*[:\-]?\s*(\d{1,6}[A-Za-z]?)/i);
  if (m1) return m1[1];

  // Just "1901"
  const m2 = t.match(/^\s*(\d{1,6}[A-Za-z]?)\s*$/);
  if (m2) return m2[1];

  return null;
}

function looksLikeApartment(text: string) {
  return Boolean(extractApartment(text));
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

// ✅ NEW: Check if user just answered the "which condominium?" question
function looksLikeCondoAnswer(text: string): boolean {
  const t = text.trim();
  // 2-60 chars, has letters, not just "ok/sim/não", no "?" at end
  if (t.length < 2 || t.length > 60) return false;
  if (!/[a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(t)) return false;
  if (/^(ok|sim|não|nao|obrigad[oa]?|valeu|blz|beleza)$/i.test(t)) return false;
  if (t.endsWith('?')) return false;
  // Avoid long technical complaints being treated as condo names
  if (isOperationalIssue(t) && t.length > 30) return false;
  return true;
}

// ✅ NEW: Check if last assistant message asked about condominium
function lastAssistantAskedForCondo(msgs: { role: string; content: string }[]): boolean {
  const lastAssistant = getLastByRole(msgs, 'assistant');
  if (!lastAssistant) return false;
  return /condom[ií]nio|qual (?:é )?o (?:seu )?condomínio|confirmar? (?:o )?condom/i.test(lastAssistant.content);
}

// ✅ NEW: Find condo candidate in recent history (not just when assistant asked)
function findRecentCondoCandidate(msgs: { role: string; content: string }[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "user") continue;

    const t = (m.content || "").trim();
    if (!t) continue;

    // Don't confuse apt with condo
    if (extractApartment(t)) continue;

    // Valid condominium candidate
    if (looksLikeCondoAnswer(t)) return t;
  }
  return null;
}

// ✅ NEW: Normalize text for fuzzy matching
function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s]/g, '') // remove punctuation
    .replace(/\b(condominio|residencial|edificio|conjunto)\b/gi, '') // remove common prefixes
    .trim()
    .replace(/\s+/g, ' ');
}

// ✅ NEW: Question variations to avoid robotic repetition
const CONDO_QUESTIONS = [
  "Para que eu possa abrir o chamado corretamente, poderia me confirmar qual é o seu condomínio?",
  "Pra eu registrar certinho, qual é o nome do seu condomínio?",
  "Você me confirma o condomínio, por favor?",
  "Só pra localizar aqui: qual condomínio você representa?",
  "Perfeito — me diga o nome do condomínio pra eu abrir o chamado.",
  "Qual é o condomínio? (pode ser só o nome mesmo)",
];

function getCondoQuestion(conversationId: string): string {
  // Deterministic but varied: use hash of conversation_id
  let hash = 0;
  for (let i = 0; i < conversationId.length; i++) {
    hash = ((hash << 5) - hash) + conversationId.charCodeAt(i);
    hash |= 0;
  }
  return CONDO_QUESTIONS[Math.abs(hash) % CONDO_QUESTIONS.length];
}

// ---------- CONTEXT HYDRATION (avoid "perguntas bobas" / repetition) ----------
async function hydrateMessagesFromDbIfNeeded(
  supabase: any,
  conversationId: string | undefined,
  incoming: { role: string; content: string }[],
  minIncoming = 10,
  takeLast = 24
) {
  if (!conversationId) return incoming;
  if ((incoming?.length || 0) >= minIncoming) return incoming;

  const { data: rows, error } = await supabase
    .from('messages')
    .select('id, content, transcript, direction, sender_type, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: false })
    .limit(takeLast);

  if (error || !rows?.length) return incoming;

  const dbMsgs = rows
    .slice()
    .reverse()
    .map((r: any) => {
      const txt = (r.transcript ?? r.content ?? '').trim();
      if (!txt) return null;
      const role = r.direction === 'inbound' ? 'user' : 'assistant';
      return { role, content: txt };
    })
    .filter(Boolean) as { role: string; content: string }[];

  // merge + de-dupe (light)
  const merged = [...dbMsgs, ...(incoming || [])].filter(m => m.role !== 'system');
  const seen = new Set<string>();
  const deduped: { role: string; content: string }[] = [];
  for (const m of merged) {
    const k = `${m.role}::${m.content}`.slice(0, 600);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(m);
  }
  return deduped.slice(-40);
}

// ---------- Deterministic override -> LLM wording ----------
type DeterministicOverride =
  | { kind: 'need_condo' }
  | { kind: 'condo_clarification'; options: string[] }
  | { kind: 'condo_not_found'; condoName: string }
  | { kind: 'need_apartment' };

function buildOverrideInstruction(ov: DeterministicOverride): string {
  // Instruções em PT-BR, 1 pergunta por vez, humanizado, sem repetir.
  if (ov.kind === 'need_condo') {
    return [
      "Você precisa APENAS pedir o NOME DO CONDOMÍNIO para continuar.",
      "Faça UMA pergunta curta e natural.",
      "Não repita exatamente a frase anterior da conversa.",
      "Não use listas longas, não use emojis, não use texto em inglês.",
      "NÃO registre protocolo agora (não chamar ferramenta)."
    ].join("\n");
  }
  if (ov.kind === 'need_apartment') {
    return [
      "Você precisa APENAS pedir o NÚMERO DO APARTAMENTO para continuar.",
      "Faça UMA pergunta curta e natural.",
      "Não repita exatamente a frase anterior da conversa.",
      "Não use listas longas, não use emojis, não use texto em inglês.",
      "NÃO registre protocolo agora (não chamar ferramenta)."
    ].join("\n");
  }
  if (ov.kind === 'condo_clarification') {
    const opts = ov.options.slice(0, 3).join(" | ");
    return [
      "O cliente aparentemente informou o condomínio, mas existem opções parecidas no banco.",
      `Opções encontradas: ${opts}`,
      "Peça para escolher qual é o correto, em UMA pergunta curta e humana.",
      "Não faça parecer erro de sistema. Não diga 'não encontrei'.",
      "NÃO registre protocolo agora (não chamar ferramenta)."
    ].join("\n");
  }
  // condo_not_found
  return [
    `O cliente informou este condomínio: "${ov.condoName}".`,
    "Não houve correspondência clara no banco.",
    "Confirme o nome com tato, em UMA pergunta curta.",
    "Se houver outro nome (ex: 'Residencial X' vs 'Condomínio X'), peça para confirmar como aparece oficialmente.",
    "NÃO registre protocolo agora (não chamar ferramenta)."
  ].join("\n");
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
    .select('contact_id, condominium_id, active_condominium_id, contacts(name), condominiums(name)')
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

  let condominiumId = (conv as any)?.condominium_id || (conv as any)?.active_condominium_id;

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

    let messagesNoSystem = messages.filter((m: any) => m.role !== 'system');
    // ✅ If app sent short context, hydrate from DB to avoid repetition
    messagesNoSystem = await hydrateMessagesFromDbIfNeeded(supabase, conversationId, messagesNoSystem);

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
    // ✅ PATCH: Allow 'owner' or 'admin' roles to bypass this block
    const isPrivileged = (employee.roles ?? []).some(r => ['owner', 'admin'].includes(String(r).toLowerCase()));

    if (isEmployee && !hasCommand && !isPrivileged) {
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

      // Load conversation's linked condominium (if any)
      const { data: convoWithCondo } = await supabase
        .from('conversations')
        .select('active_condominium_id, condominiums(name)')
        .eq('id', conversationId)
        .maybeSingle();

      const linkedCondoName = (convoWithCondo?.condominiums as any)?.name ?? null;
      const linkedCondoId = convoWithCondo?.active_condominium_id ?? null;

      // Load known condominiums to help extraction
      const { data: condos } = await supabase.from('condominiums').select('name').limit(500);
      const knownCondominiums = (condos ?? []).map((c: any) => c.name).filter(Boolean);

      const extracted = await parseAndExtract(null, {
        text: textForExtraction,
        isEmployee: true,
        knownCondominiums
      });

      // Auto-fill condominium from conversation link if not in text
      if (!extracted.fields.condominium_name && linkedCondoName) {
        console.log('[AI] Using linked condominium from conversation:', linkedCondoName);
        extracted.fields.condominium_name = linkedCondoName;
        extracted.missing_fields = extracted.missing_fields.filter(f => f !== 'condominium_name');
        extracted.draft = extracted.missing_fields.length > 0;
      }

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

    const lastIssueMsg = [...messagesNoSystem].reverse().find((m: any) => m.role === 'user' && isOperationalIssue(m.content));
    const hasOperationalContext = isOperationalIssue(recentText);

    // ✅ FIX: Use extractApartment for better parsing of "apt 1901"
    const aptCandidate = [...messagesNoSystem]
      .reverse()
      .map((m: any) => (m.role === "user" ? extractApartment(m.content) : null))
      .find(Boolean) || null;

    const isProvidingApartment = Boolean(extractApartment(lastUserMsgText)) && hasOperationalContext;
    const needsApartment = /(interfone|tv|controle|apartamento|apto|unidade)/i.test(recentText);
    const canOpenNow = hasIdentifiedCondo && hasOperationalContext && (!needsApartment || Boolean(aptCandidate));

    let deterministicOverride: DeterministicOverride | null = null;

    if (!hasIdentifiedCondo && hasOperationalContext && conversationId) {
      // ✅ SMART CONDO DETECTION: Search history for condo name, not just when assistant asked
      const condoCandidateText = findRecentCondoCandidate(messagesNoSystem);
      const userProvidedCondoName = Boolean(condoCandidateText);
      const condoText = condoCandidateText || lastUserMsgText;

      if (userProvidedCondoName) {
        console.log(`[TICKET] User appears to have provided condo name: "${condoText}"`);

        // ✅ FIX: Use AND matching (all words must be present) instead of OR
        const searchTerm = normalizeForSearch(condoText);
        const words = searchTerm.split(" ").filter(w => w.length > 2);

        if (words.length > 0) {
          // Use the longest word as seed for initial search to reduce noise
          const seed = words.slice().sort((a, b) => b.length - a.length)[0];

          const { data: candidates } = await supabase
            .from("condominiums")
            .select("id, name")
            .ilike("name", `%${seed}%`)
            .limit(30);

          // ✅ AND filter: must contain ALL words
          const matchingCondos = (candidates || []).filter((c: any) => {
            const n = normalizeForSearch(c.name || "");
            return words.every(w => n.includes(w));
          }).slice(0, 5);

          if (matchingCondos && matchingCondos.length === 1) {
            // Single match - auto-link and proceed
            const matchedCondo = matchingCondos[0];
            console.log(`[TICKET] Auto-linking to condo: ${matchedCondo.name} (${matchedCondo.id})`);

            await supabase.from('conversations')
              .update({ active_condominium_id: matchedCondo.id })
              .eq('id', conversationId);

            // Now we have condo, let flow continue to check if can open ticket
            // (will be handled in the next block)
          } else if (matchingCondos && matchingCondos.length > 1) {
            // Multiple matches - ask for clarification
            const options = matchingCondos.slice(0, 3).map((c: any) => c.name);
            console.log(`[TICKET] Multiple condo matches found: ${options.join(', ')}`);
            deterministicOverride = {
              kind: 'condo_clarification',
              options: options
            };
          } else {
            // No matches - confirm what they said
            console.log(`[TICKET] No condo match for: "${condoText}"`);
            deterministicOverride = { kind: 'condo_not_found', condoName: condoText };
          }
        }
      } else {
        // First time asking for condo
        console.log('[TICKET] Deterministic block: Missing condominium identification.');
        deterministicOverride = { kind: 'need_condo' };
      }
    }

    // Re-check if we just linked a condo
    const { data: convDataRefresh } = await supabase
      .from('conversations')
      .select('active_condominium_id')
      .eq('id', conversationId)
      .maybeSingle();
    const hasIdentifiedCondoNow = Boolean(convDataRefresh?.active_condominium_id);
    const canOpenNowRefresh = hasIdentifiedCondoNow && hasOperationalContext && (!needsApartment || Boolean(aptCandidate));

    // ✅ FIX: isProvidingApartment must also have condo identified
    const canActuallyOpen = (canOpenNow || canOpenNowRefresh) && !deterministicOverride;
    const isProvidingApartmentWithCondo = isProvidingApartment && hasIdentifiedCondoNow && !deterministicOverride;

    if (conversationId && (canActuallyOpen || isProvidingApartmentWithCondo)) {
      if (needsApartment && !aptCandidate) {
        console.log('[TICKET] Deterministic block: Need apartment for issue:', lastIssueMsg?.content);
        deterministicOverride = { kind: 'need_apartment' };
      }

      try {
        const ticketData = await executeCreateProtocol(
          supabase,
          supabaseUrl,
          supabaseServiceKey,
          conversationId,
          participant_id,  // ✅ FIX: Added missing parameter
          {
            summary: (lastIssueMsg?.content || lastUserMsgText).slice(0, 500),
            priority: /travado|urgente|urgência|emergência/i.test(recentText) ? 'critical' : 'normal',
            apartment: aptCandidate
          }
        );

        const protocolCode = ticketData.protocol?.protocol_code || ticketData.protocol_code;

        // Protocol confirmation variations
        const CONFIRMS = [
          `Certo. Chamado registrado sob o protocolo ${protocolCode}. Já encaminhei para a equipe operacional e seguimos por aqui.`,
          `Perfeito — protocolei como ${protocolCode}. Já direcionei para a equipe operacional e vamos acompanhando por aqui.`,
          `Entendido. Protocolo ${protocolCode} registrado e encaminhado. Qualquer ajuste ou detalhe, me avise por aqui.`,
          `Combinado. Registrei o chamado (${protocolCode}) e já deixei encaminhado para a equipe. Seguimos por aqui.`
        ];
        // Choose variation deterministic (stable)
        let h = 0; const seed = `${conversationId}:${protocolCode}`;
        for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
        const msg = CONFIRMS[h % CONFIRMS.length];

        return new Response(JSON.stringify({
          text: msg,
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

    // Build override instruction if deterministic guardrail triggered
    const overrideInstruction = deterministicOverride ? buildOverrideInstruction(deterministicOverride) : '';

    // Final Prompt Reinforcement
    const cleanPrompt = `${basePrompt}

Reforce as regras críticas do atendimento (tom humano, sem repetição, 1 pergunta por vez, sem prometer prazo).
Quando faltar dado obrigatório para protocolo, pergunte apenas o que falta e aguarde.
${overrideInstruction ? `\n[INSTRUÇÕES DE CONTROLE]\n${overrideInstruction}\n` : ''}`;

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
            // ✅ If deterministicOverride is set, disable tools (text-only response)
            tools: deterministicOverride ? [] : protocolTool,
            tool_choice: deterministicOverride ? 'none' : 'auto',
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
          contents: messagesNoSystem.map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          // ✅ If deterministicOverride is set, disable tools (text-only response)
          ...(deterministicOverride ? {} : { tools: [{ functionDeclarations: [protocolTool[0].function] }] }),
          toolConfig: { functionCallingConfig: { mode: deterministicOverride ? "NONE" : "AUTO" } },
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
    // ✅ Don't trigger fallback when in guardrail mode (deterministicOverride)
    if (!deterministicOverride && !functionCall && aiSaidWillRegister) {
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

    // ✅ FALLBACK: If LLM returned empty text and we have a deterministicOverride, use fallback text
    if (!generatedText.trim() && deterministicOverride) {
      console.warn(`[AI] LLM returned empty text with override=${deterministicOverride.kind}, using fallback`);
      if (deterministicOverride.kind === 'need_condo') {
        generatedText = getCondoQuestion(conversationId || '');
      } else if (deterministicOverride.kind === 'need_apartment') {
        generatedText = "Entendido. Para que eu possa registrar certinho, poderia me confirmar o número do seu apartamento?";
      } else if (deterministicOverride.kind === 'condo_clarification') {
        const opts = deterministicOverride.options.slice(0, 3).join(', ');
        generatedText = `Encontrei algumas opções: ${opts}. Qual desses é o seu condomínio?`;
      } else if (deterministicOverride.kind === 'condo_not_found') {
        generatedText = `Perfeito — é o condomínio ${deterministicOverride.condoName}, certo? Me confirma por favor.`;
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
