// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Traduzir categoria para português
function translateCategory(category: string): string {
  const map: Record<string, string> = {
    operational: "Operacional",
    support: "Suporte",
    financial: "Financeiro",
    commercial: "Comercial",
    admin: "Administrativo",
    cftv: "CFTV",
    interfone: "Interfone",
    antena_coletiva: "Antena Coletiva",
    portao_veicular: "Portão Veicular",
    porta_pedestre: "Porta Pedestre",
    controle_acesso_pedestre: "Acesso Pedestre",
    controle_acesso_veicular: "Acesso Veicular",
    infraestrutura: "Infraestrutura",
    cerca_eletrica: "Cerca Elétrica",
    alarme: "Alarme",
    concertina: "Concertina",
    infra: "Infraestrutura"
  };
  return map[category] || "Operacional";
}

// Validar UUID para evitar crash do banco
function isValidUUID(uuid: any) {
  if (typeof uuid !== 'string' || !uuid) return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}

// AI Classification function
interface ClassificationResult {
  category: 'financial' | 'support' | 'admin' | 'operational';
  tags: string[];
  confidence: number;
}

async function classifyProtocolWithAI(summary: string, supabaseUrl: string, serviceKey: string): Promise<ClassificationResult | null> {
  try {
    const supabaseClient = createClient(supabaseUrl, serviceKey);
    const { data: settings } = await supabaseClient.from('ai_settings').select('openrouter_api_key').maybeSingle();

    if (!settings?.openrouter_api_key) {
      console.log('[AI Classification] No OpenRouter API key configured');
      return null;
    }

    const classificationPrompt = `Analise o texto abaixo e classifique:

TEXTO: "${summary}"

CATEGORIAS DISPONÍVEIS:
- financial: cobranças, boletos, pagamentos, orçamentos, taxas
- support: reclamações, dúvidas, elogios, sugestões, problemas
- admin: cadastros, documentos, assembleias, comunicados
- operational: manutenção, reservas, limpeza, portaria

TAGS DISPONÍVEIS:
orcamento, cobranca, 2via_boleto, pagamento, manutencao, reserva_area, limpeza, portaria, reclamacao, duvida, elogio, sugestao, cadastro, documentos, assembleia, comunicado

Responda APENAS em JSON válido, sem markdown:
{"category": "categoria", "tags": ["tag1", "tag2"], "confidence": 0.85}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openrouter_api_key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wappal-connect.vercel.app',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: classificationPrompt }],
        max_tokens: 150,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error('[AI Classification] API error:', await response.text());
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) return null;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    console.log('[AI Classification] Result:', result);

    return {
      category: result.category || 'operational',
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 3) : [],
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
    };
  } catch (error) {
    console.error('[AI Classification] Error:', error);
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('--- [create-protocol] REQUISIÇÃO v6 ---');

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let conversation_id_for_log = null;
  const logBuffer: string[] = [];
  const log = (msg: string) => { console.log(msg); logBuffer.push(msg); };

  try {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      throw new Error('Corpo da requisição não é um JSON válido.');
    }

    const conversation_id = body.conversation_id;
    const condominium_id = body.condominium_id;
    const participant_id = body.participant_id;
    const contact_id = body.contact_id;
    const category = body.category;
    const priority = body.priority;
    const summary = body.summary;
    const created_by_agent_id = body.created_by_agent_id ?? null;
    // DEFAULTS: If frontend didn't send flags, assume TRUE (manual protocol should notify)
    const toBool = (v: any, defaultValue = true) => {
      if (v === undefined || v === null) return defaultValue;
      if (v === true || v === "true" || v === 1 || v === "1") return true;
      if (v === false || v === "false" || v === 0 || v === "0") return false;
      return defaultValue;
    };

    const notify_group = toBool(body.notify_group, true);
    const notify_client = toBool(body.notify_client, true);
    const force_new = toBool(body.force_new, true);

    const requester_name = body.requester_name;
    const requester_role = body.requester_role;
    const apartment = body.apartment;
    const template_id = body.template_id;
    const condominium_name = body.condominium_name ?? null;
    const created_by_type = body.created_by_type ?? 'ai';
    const source_message_id = body.source_message_id ?? null;

    log(`[create-protocol] Flags: notify_group=${notify_group}, notify_client=${notify_client}, force_new=${force_new}`);

    // Helper: Resolve condominium ID by name
    async function resolveCondominiumIdByName(name: string | null): Promise<string | null | { ambiguous: true; options: any[] }> {
      if (!name || name.trim().length < 3) return null;

      const q = name.trim();

      // 1) Exact match (case-insensitive)
      let { data } = await supabaseClient
        .from("condominiums")
        .select("id, name")
        .ilike("name", q)
        .limit(5);

      // 2) Fallback: contains
      if (!data || data.length === 0) {
        ({ data } = await supabaseClient
          .from("condominiums")
          .select("id, name")
          .ilike("name", `%${q}%`)
          .limit(5));
      }

      if (!data || data.length === 0) return null;
      if (data.length === 1) return data[0].id;

      // Multiple matches - ambiguous
      return { ambiguous: true, options: data.slice(0, 5) };
    }

    if (isValidUUID(conversation_id)) conversation_id_for_log = conversation_id;

    if (!conversation_id || !isValidUUID(conversation_id)) {
      return new Response(JSON.stringify({ error: 'conversation_id inválido ou ausente' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    log(`[create-protocol] Buscando conversa ${conversation_id}...`);
    const { data: conv, error: convError } = await supabaseClient
      .from('conversations')
      .select('id, active_condominium_id, active_condominium_confidence, contact_id, contacts(name)')
      .eq('id', conversation_id)
      .maybeSingle();

    if (convError) throw new Error(`Erro ao buscar conversa: ${convError.message}`);
    if (!conv) throw new Error(`Conversa ${conversation_id} não encontrada.`);

    const contact = conv.contacts as any;

    let resolvedCondoId = null;
    let source = 'none';

    // ✅ CHECK IDEMPOTENCY: Se já existe um protocolo aberto nesta conversa, reusa ele.
    // O 'force_new' permite ignorar esta trava se vier explicitamente via botão manual.
    if (!force_new) {
      log(`[create-protocol] Checking idempotency for conversation ${conversation_id}`);
      const { data: existingProtocol } = await supabaseClient
        .from('protocols')
        .select('id, protocol_code, status, created_at')
        .eq('conversation_id', conversation_id)
        .in('status', ['open', 'queued', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingProtocol) {
        log(`[IDEMPOTENCY] Reusing existing protocol: ${existingProtocol.protocol_code}`);
        return new Response(JSON.stringify({
          success: true,
          protocol_id: existingProtocol.id,
          protocol_code: existingProtocol.protocol_code,
          reused: true
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // ✅ PRIORITY 1: ID explícito tem prioridade
    if (condominium_id && isValidUUID(condominium_id)) {
      resolvedCondoId = condominium_id;
      source = 'input_direct';
      log(`[create-protocol] Using explicit condominium_id: ${resolvedCondoId}`);
    }

    // ✅ PRIORITY 2: ID ativo com confiança >= 70%
    if (!resolvedCondoId) {
      // Use active_condominium_id only if confidence >= 0.70 (reasonably confident)
      if (conv.active_condominium_id && (conv.active_condominium_confidence ?? 0) >= 0.70) {
        resolvedCondoId = conv.active_condominium_id;
        source = 'active_condominium_id';
        log(`[create-protocol] Using active_condominium_id (conf ${conv.active_condominium_confidence}): ${resolvedCondoId}`);
      }
    }

    // ✅ PRIORITY 3: Tentar resolver por nome
    if (!resolvedCondoId && condominium_name) {
      log(`[create-protocol] Attempting to resolve condominium by name: "${condominium_name}"`);
      const nameResolution = await resolveCondominiumIdByName(condominium_name);

      if (nameResolution && typeof nameResolution === 'object' && 'ambiguous' in nameResolution) {
        // Multiple condominiums match - cannot proceed
        const options = nameResolution.options.map((o: any) => o.name).join(', ');
        log(`[create-protocol] Ambiguous condominium name. Options: ${options}`);
        return new Response(JSON.stringify({
          error: 'Condomínio ambíguo',
          message: `Encontrei ${nameResolution.options.length} condomínios com nome parecido. Confirme qual é:\n${options}`
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (nameResolution && typeof nameResolution === 'string') {
        resolvedCondoId = nameResolution;
        source = 'name_lookup';
        log(`[create-protocol] Resolved condominium by name: ${resolvedCondoId}`);
      } else {
        // ✅ NEW: Not found - log warning but allow creation with raw name
        log(`[create-protocol] WARNING: Condominium "${condominium_name}" not found in DB. Creating protocol without condo_id.`);
        resolvedCondoId = null; // Explicitly set to null
        source = 'name_only_not_in_db';
      }
    }

    if (!resolvedCondoId && participant_id && isValidUUID(participant_id)) {
      const { data: participant } = await supabaseClient
        .from('participants')
        .select('entity_id')
        .eq('id', participant_id)
        .maybeSingle();

      if (participant?.entity_id && isValidUUID(participant.entity_id)) {
        resolvedCondoId = participant.entity_id;
        source = 'participant_entity';
      }
    }

    if (!resolvedCondoId) {
      const { data: partState } = await supabaseClient
        .from('conversation_participant_state')
        .select('participants(entity_id)')
        .eq('conversation_id', conversation_id)
        .maybeSingle();

      const entityId = (partState as any)?.participants?.entity_id;
      if (entityId && isValidUUID(entityId)) {
        resolvedCondoId = entityId;
        source = 'sender_entity';
      }
    }

    // IDEMPOTENCY - Only block if force_new=false AND recent draft exists
    if (!force_new) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existingProtocol } = await supabaseClient
        .from('protocols')
        .select('*')
        .eq('conversation_id', conversation_id)
        .in('status', ['open', 'draft'])
        .gte('created_at', fiveMinutesAgo)
        .maybeSingle();

      if (existingProtocol) {
        log(`[create-protocol] Recent protocol exists (${existingProtocol.protocol_code}), returning it.`);
        return new Response(JSON.stringify({
          success: true,
          already_existed: true,
          protocol_code: existingProtocol.protocol_code,
          protocol: existingProtocol
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Code Gen
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { data: seqData, error: seqError } = await supabaseClient
      .rpc('get_next_protocol_sequence', { year_month_param: yearMonth });

    if (seqError) throw new Error(`Erro ao gerar código do protocolo: ${seqError.message}`);

    const sequence = String(seqData).padStart(4, '0');
    const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
    const protocolCode = `${yearMonth}-${sequence}-${suffix}`;

    // 6.5. RESOLVE TEMPLATE & AI CLASSIFICATION
    let aiClassification: ClassificationResult | null = null;
    let bestTemplate = null;
    let aiClassified = false;

    const { data: templates } = await supabaseClient
      .from('task_templates')
      .select('*')
      .eq('active', true);

    if (template_id && isValidUUID(template_id)) {
      bestTemplate = templates?.find((t: any) => t.id === template_id) || null;
      log(`[create-protocol] Using explicit template: ${bestTemplate?.title}`);
    } else if (summary && templates) {
      log(`[create-protocol] Matching template via keywords...`);
      const lowerSummary = summary.toLowerCase();
      let maxMatches = 0;
      let maxPriority = -1;
      for (const t of templates) {
        const keywords = t.match_keywords || [];
        let matches = 0;
        for (const kw of keywords) {
          if (lowerSummary.includes(kw.toLowerCase())) matches++;
        }

        const priority = t.match_priority || 0;

        if (matches > maxMatches || (matches === maxMatches && priority > maxPriority && matches > 0)) {
          maxMatches = matches;
          maxPriority = priority;
          bestTemplate = t;
        }
      }

      if (summary.length > 10) {
        aiClassification = await classifyProtocolWithAI(summary, supabaseUrl, supabaseServiceKey);
        if (aiClassification) {
          aiClassified = true;
          if (!bestTemplate) {
            bestTemplate = templates.find((t: any) => t.category === aiClassification?.category) || null;
          }
        }
      }
    }

    // ✅ MAPEAR E BLINDAR VALORES (Dever cumprido com o Banco de Dados)
    const mapCategory = (c?: string): string => {
      const allowed = new Set(['operational', 'financial', 'support', 'admin']);
      const raw = (c || 'operational').toLowerCase();
      if (allowed.has(raw)) return raw;
      // Mapeamento de categorias técnicas para as do banco
      const technicalMap: Record<string, string> = {
        cftv: 'support',
        interfone: 'support',
        antena_coletiva: 'support',
        portao_veicular: 'operational',
        porta_pedestre: 'operational',
        controle_acesso_pedestre: 'operational',
        controle_acesso_veicular: 'operational',
        infraestrutura: 'operational',
        cerca_eletrica: 'support',
        alarme: 'support',
        concertina: 'operational',
        infra: 'operational',
        commercial: 'admin'
      };
      const result = technicalMap[raw] || 'support';
      console.log(`[create-protocol] Category mapping: ${raw} -> ${result}`);
      return result;
    };

    const mapPriority = (p?: string): string => {
      const allowed = new Set(['normal', 'critical']);
      const raw = (p || 'normal').toLowerCase();
      if (allowed.has(raw)) return raw;
      if (raw === 'urgent' || raw === 'high' || raw === 'alta') return 'critical';
      return 'normal';
    };

    const mapStatus = (s?: string): string => {
      const allowed = new Set(['open', 'resolved', 'cancelled']);
      const raw = (s || 'open').toLowerCase();
      if (allowed.has(raw)) return raw;
      if (raw === 'closed' || raw === 'fechado') return 'resolved';
      return 'open';
    };

    const finalCategoryRaw = bestTemplate?.category || category || aiClassification?.category || 'operational';
    const finalCategory = mapCategory(finalCategoryRaw);
    const finalPriority = mapPriority(priority);
    const finalStatus = 'open'; // Sempre abre como open
    const finalTags = aiClassification?.tags || [];

    log(`[create-protocol] Resolved Fields: category=${finalCategory} (from ${finalCategoryRaw}), priority=${finalPriority}, status=${finalStatus}`);

    // ✅ FIX: Calcular due_date para protocols baseado na criticidade
    const calculateDueDate = (days: number): string => {
      let dueDate = new Date();
      let addedDays = 0;
      while (addedDays < days) {
        dueDate.setDate(dueDate.getDate() + 1);
        if (dueDate.getDay() !== 0 && dueDate.getDay() !== 6) addedDays++;
      }
      return dueDate.toISOString().split('T')[0];
    };

    const slaDaysProtocol = bestTemplate?.sla_business_days ?? 2;
    const criticalityProtocol = bestTemplate?.criticality ?? 'non_critical';
    // Crítico = mesmo dia, não-crítico = até 2 dias úteis
    const protocolDueDate = criticalityProtocol === 'critical'
      ? new Date().toISOString().split('T')[0]
      : calculateDueDate(slaDaysProtocol);

    log(`[create-protocol] Template: ${bestTemplate?.title || 'default'}, Criticality: ${criticalityProtocol}, Due Date: ${protocolDueDate}`);

    const { data: protocolRecord, error: protocolError } = await supabaseClient
      .from('protocols')
      .insert({
        protocol_code: protocolCode,
        conversation_id,
        contact_id: isValidUUID(contact_id) ? contact_id : null,
        condominium_id: isValidUUID(resolvedCondoId) ? resolvedCondoId : null,
        condominium_raw_name: isValidUUID(resolvedCondoId) ? null : (condominium_name || 'Não Identificado'), // ✅ Garantir constraint protocols_condo_present_chk
        participant_id: isValidUUID(participant_id) ? participant_id : null,
        category: finalCategory,
        priority: finalPriority,
        due_date: protocolDueDate, // ✅ FIX: Popular due_date no protocolo
        summary: summary || 'Gerado via sistema',
        status: finalStatus,
        created_by_agent_id: isValidUUID(created_by_agent_id) ? created_by_agent_id : null,
        created_by_type: created_by_agent_id ? 'agent' : 'ai',
        requester_name: requester_name || contact?.name || 'Não informado',
        requester_role: requester_role || 'Morador',
        apartment: apartment,
        tags: finalTags,
        ai_classified: aiClassified,
        ai_confidence: aiClassification?.confidence || null,
      })
      .select()
      .single();

    if (protocolError) throw protocolError;

    // 6.6. CREATE WORK ITEM
    log(`[create-protocol] Creating work item for protocol ${protocolRecord.id}...`);
    try {
      const template = bestTemplate;
      const wiTitle = template?.title ?? `Atendimento - ${translateCategory(finalCategory)}`;
      const wiMinutes = template?.default_minutes ?? 60;
      const criticality = template?.criticality ?? 'non_critical';
      const slaDays = template?.sla_business_days ?? 2;

      const calculateDueDate = (days: number): string => {
        let dueDate = new Date();
        let addedDays = 0;
        while (addedDays < days) {
          dueDate.setDate(dueDate.getDate() + 1);
          if (dueDate.getDay() !== 0 && dueDate.getDay() !== 6) addedDays++;
        }
        return dueDate.toISOString().split('T')[0];
      };

      const dueDate = slaDays === 0 ? new Date().toISOString().split('T')[0] : calculateDueDate(slaDays);

      const { data: workItem, error: wiErr } = await supabaseClient
        .from('protocol_work_items')
        .insert({
          protocol_id: protocolRecord.id,
          category: finalCategory,
          priority: priority || 'normal',
          title: wiTitle,
          estimated_minutes: wiMinutes,
          required_people: template?.required_people ?? 1,
          required_skill_codes: template?.required_skill_codes ?? [],
          status: 'open',
          criticality,
          sla_business_days: slaDays,
          due_date: dueDate,
        })
        .select('id')
        .single();

      if (!wiErr && template?.default_materials) {
        await supabaseClient.from('material_requests').insert({ work_item_id: workItem.id, items: template.default_materials });
      }
    } catch (wiEx: any) { log(`Work item failed but protocol created: ${wiEx.message}`); }

    // Finalize
    await supabaseClient.from('conversations').update({ protocol: protocolCode }).eq('id', conversation_id);

    // Final flags
    let groupNotified = false;
    let clientNotified = false;

    // ✅ DIAGNOSTIC NOTIFICATION FLOW
    let groupRespInfo: any = null;
    let clientRespInfo: any = null;

    const callFn = async (fn: string, body: any) => {
      try {
        const r = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const text = await r.text().catch(() => "");
        return { ok: r.ok, status: r.status, body: text };
      } catch (e: any) {
        return { ok: false, status: 0, body: e.message };
      }
    };

    // Notify group
    if (notify_group) {
      log(`[create-protocol] Calling protocol-opened for ${protocolCode}...`);
      groupRespInfo = await callFn("protocol-opened", {
        protocol_id: protocolRecord.id,
        protocol_code: protocolRecord.protocol_code,
        idempotency_key: `protocol-opened:${protocolRecord.id}`,
      });
      if (groupRespInfo.ok) groupNotified = true;
    }

    // Notify client
    if (notify_client && conversation_id) {
      log(`[create-protocol] Calling protocol-client for ${protocolCode}...`);
      clientRespInfo = await callFn("protocol-client", {
        protocol_id: protocolRecord.id,
        protocol_code: protocolRecord.protocol_code,
        conversation_id,
        idempotency_key: `protocol-client:${protocolRecord.id}`,
      });
      if (clientRespInfo.ok) clientNotified = true;
    }

    return new Response(JSON.stringify({
      success: true,
      protocol_created: true,
      protocol_id: protocolRecord.id,
      protocol_code: protocolCode,
      group_notified: groupNotified,
      client_notified: clientNotified,
      group_notification: groupRespInfo,
      client_notification: clientRespInfo,
      protocol: protocolRecord
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[create-protocol] Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
