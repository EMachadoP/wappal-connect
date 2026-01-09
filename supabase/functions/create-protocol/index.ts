import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Validar UUID para evitar crash do banco
function isValidUUID(uuid: any) {
  if (typeof uuid !== 'string' || !uuid) return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}

serve(async (req) => {
  // 1. Handle CORS early
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('--- [create-protocol] REQUISIÇÃO v5 ---');

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let conversation_id_for_log = null;
  const logBuffer: string[] = [];
  const log = (msg: string) => { console.log(msg); logBuffer.push(msg); };

  try {
    // 2. Parse Body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      throw new Error('Corpo da requisição não é um JSON válido.');
    }

    let {
      conversation_id,
      condominium_id,
      participant_id,
      contact_id,
      category,
      priority,
      summary,
      created_by_agent_id,
      notify_group,
      requester_name,
      requester_role,
      apartment
    } = body;

    if (isValidUUID(conversation_id)) conversation_id_for_log = conversation_id;

    // 3. Validação de ID de Conversa
    if (!conversation_id || !isValidUUID(conversation_id)) {
      console.error('[create-protocol] Erro: conversation_id inválido:', conversation_id);
      return new Response(JSON.stringify({ error: 'conversation_id inválido ou ausente' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Buscar conversa e contato
    log(`[create-protocol] Buscando conversa ${conversation_id}...`);
    const { data: conv, error: convError } = await supabaseClient
      .from('conversations')
      .select('id, active_condominium_id, contact_id, contacts(name)')
      .eq('id', conversation_id)
      .maybeSingle();

    if (convError) throw new Error(`Erro ao buscar conversa: ${convError.message}`);
    if (!conv) throw new Error(`Conversa ${conversation_id} não encontrada.`);

    const contact = conv.contacts as any;

    // 5. Resolução de Condomínio
    let resolvedCondoId = null;
    let source = 'none';

    // Try direct input first
    if (condominium_id && isValidUUID(condominium_id)) {
      resolvedCondoId = condominium_id;
      source = 'input_direct';
    }

    // Try conversation's active_condominium_id
    if (!resolvedCondoId) {
      resolvedCondoId = conv.active_condominium_id;
      if (resolvedCondoId) source = 'conversation';
    }

    // Try participant's entity_id (if participant_id is provided)
    if (!resolvedCondoId && participant_id && isValidUUID(participant_id)) {
      log(`[create-protocol] Looking up participant ${participant_id} for entity_id...`);
      const { data: participant } = await supabaseClient
        .from('participants')
        .select('entity_id, entity:entities(name)')
        .eq('id', participant_id)
        .maybeSingle();

      if (participant?.entity_id && isValidUUID(participant.entity_id)) {
        resolvedCondoId = participant.entity_id;
        source = 'participant_entity';
        log(`[create-protocol] Resolved condominium from participant: ${participant.entity_id}`);
      }
    }

    // Fallback: Try conversation_participant_state
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

    // 5.5. IDEMPOTENCY CHECK - Verificar se já existe protocolo aberto para esta conversa
    log(`[create-protocol] Checking for existing protocol...`);
    const { data: existingProtocol } = await supabaseClient
      .from('protocols')
      .select('*')
      .eq('conversation_id', conversation_id)
      .eq('status', 'open')
      .maybeSingle();

    if (existingProtocol) {
      log(`[create-protocol] Protocol already exists: ${existingProtocol.protocol_code}`);
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

    // 6. Criar Protocolo com código sequencial
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get next sequence from database
    const { data: seqData, error: seqError } = await supabaseClient
      .rpc('get_next_protocol_sequence', { year_month_param: yearMonth });

    if (seqError) {
      log(`[create-protocol] Erro ao obter sequência: ${seqError.message}`);
      throw new Error(`Erro ao gerar código do protocolo: ${seqError.message}`);
    }

    const sequence = String(seqData).padStart(4, '0');
    const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
    const protocolCode = `${yearMonth}-${sequence}-${suffix}`;
    log(`[create-protocol] Criando ${protocolCode} via ${source}...`);
    log(`[create-protocol] Data: conv=${conversation_id}, condo=${resolvedCondoId}, contact=${contact_id}, summary=${summary}`);

    // Validate foreign keys before insertion
    log(`[create-protocol] Validating foreign keys...`);

    // Validate conversation_id (required)
    if (!conversation_id || !isValidUUID(conversation_id)) {
      throw new Error(`Invalid conversation_id: ${conversation_id}`);
    }

    // Validate contact_id if provided
    if (contact_id && isValidUUID(contact_id)) {
      const { data: contactExists } = await supabaseClient
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .maybeSingle();

      if (!contactExists) {
        log(`[create-protocol] WARNING: contact_id ${contact_id} does not exist, setting to null`);
        contact_id = null;
      }
    } else {
      contact_id = null;
    }

    // Validate condominium_id if provided (check entities table first, then condominiums)
    if (resolvedCondoId && isValidUUID(resolvedCondoId)) {
      let condoIsValid = false;

      // First check if it's in entities table (where Identificar Remetente saves)
      try {
        const { data: entityExists, error: entityError } = await supabaseClient
          .from('entities')
          .select('id')
          .eq('id', resolvedCondoId)
          .eq('type', 'condominio')
          .maybeSingle();

        if (!entityError && entityExists) {
          condoIsValid = true;
          log(`[create-protocol] Condominium found in entities table`);
        }
      } catch (e) {
        log(`[create-protocol] Error checking entities table: ${e.message}`);
      }

      // Then check condominiums table as fallback
      if (!condoIsValid) {
        try {
          const { data: condoExists, error: condoError } = await supabaseClient
            .from('condominiums')
            .select('id')
            .eq('id', resolvedCondoId)
            .maybeSingle();

          if (!condoError && condoExists) {
            condoIsValid = true;
            log(`[create-protocol] Condominium found in condominiums table`);
          }
        } catch (e) {
          log(`[create-protocol] Error checking condominiums table: ${e.message}`);
        }
      }

      if (!condoIsValid) {
        log(`[create-protocol] WARNING: condominium_id ${resolvedCondoId} not found in entities or condominiums, setting to null`);
        resolvedCondoId = null;
      }
    } else {
      resolvedCondoId = null;
    }

    // Validate participant_id if provided
    if (participant_id && isValidUUID(participant_id)) {
      const { data: partExists } = await supabaseClient
        .from('participants')
        .select('id')
        .eq('id', participant_id)
        .maybeSingle();

      if (!partExists) {
        log(`[create-protocol] WARNING: participant_id ${participant_id} does not exist, setting to null`);
        participant_id = null;
      }
    } else {
      participant_id = null;
    }

    log(`[create-protocol] Validated IDs: contact=${contact_id}, condo=${resolvedCondoId}, participant=${participant_id}`);

    const { data: protocolRecord, error: protocolError } = await supabaseClient
      .from('protocols')
      .insert({
        protocol_code: protocolCode,
        conversation_id,
        contact_id: isValidUUID(contact_id) ? contact_id : null,
        condominium_id: isValidUUID(resolvedCondoId) ? resolvedCondoId : null,
        participant_id: isValidUUID(participant_id) ? participant_id : null,
        category: category || 'operational',
        priority: priority || 'normal',
        summary: summary || 'Gerado via sistema',
        status: 'open',
        created_by_agent_id: isValidUUID(created_by_agent_id) ? created_by_agent_id : null,
        created_by_type: created_by_agent_id ? 'agent' : 'ai',
        requester_name: requester_name || contact?.name || 'Não informado',
        requester_role: requester_role || 'Morador',
        apartment: apartment
      })
      .select()
      .single();

    if (protocolError) {
      log(`[create-protocol] ERRO INSERT: ${JSON.stringify(protocolError)}`);
      log(`[create-protocol] Data sent: ${JSON.stringify({
        protocol_code: protocolCode,
        conversation_id,
        contact_id,
        condominium_id: resolvedCondoId,
        participant_id: isValidUUID(participant_id) ? participant_id : null,
        category: category || 'operational',
        priority: priority || 'normal',
        summary: summary || 'Gerado via sistema',
        status: 'open',
        created_by_agent_id: isValidUUID(created_by_agent_id) ? created_by_agent_id : null,
        created_by_type: created_by_agent_id ? 'agent' : 'ai',
        requester_name: requester_name || contact?.name || 'Não informado',
        requester_role: requester_role || 'Morador',
        apartment: apartment
      })}`);
      throw new Error(`Erro ao inserir protocolo: ${protocolError.message} | Details: ${protocolError.details} | Hint: ${protocolError.hint}`);
    }


    // 7. Ações Pós-Criação
    try {
      await supabaseClient.from('conversations').update({ protocol: protocolCode, active_condominium_id: resolvedCondoId || conv.active_condominium_id }).eq('id', conversation_id);
    } catch (e) { log(`Falha update conv: ${e.message}`); }

    // NOTIFY GROUP (WhatsApp + Asana via protocol-opened)
    if (notify_group) {
      try {
        log(`[create-protocol] Disparando protocol-opened para ${protocolCode}...`);

        let condoName = 'Não identificado';
        if (resolvedCondoId) {
          try {
            // First try entities table (where Identificar Remetente saves)
            const { data: entityData, error: entityError } = await supabaseClient
              .from('entities')
              .select('name')
              .eq('id', resolvedCondoId)
              .eq('type', 'condominio')
              .maybeSingle();

            if (!entityError && entityData) {
              condoName = entityData.name;
            } else {
              // Fallback to condominiums table
              const { data: condoData, error: condoError } = await supabaseClient
                .from('condominiums')
                .select('name')
                .eq('id', resolvedCondoId)
                .maybeSingle();

              if (!condoError && condoData) {
                condoName = condoData.name;
              }
            }
          } catch (e) {
            log(`[create-protocol] Error fetching condominium name: ${e.message}`);
            // Keep default 'Não identificado'
          }
        }

        await fetch(`${supabaseUrl}/functions/v1/protocol-opened`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            protocol_id: protocolRecord.id,
            protocol_code: protocolCode,
            priority: priority || 'normal',
            category: category || 'operational',
            summary: summary || 'Gerado via sistema',
            condominium_id: resolvedCondoId,
            condominium_name: condoName,
            conversation_id: conversation_id,
            contact_id: conv.contact_id,
            requester_name: requester_name || contact?.name || 'Não informado',
            requester_role: requester_role || 'Morador'
          })
        });
      } catch (e) { log(`Falha protocol-opened: ${e.message}`); }
    } else {
      // Fallback manual notifications if notify_group is false
      try {
        await supabaseClient.from('notifications').insert({
          conversation_id,
          notification_type: 'ticket_created',
          message: `Protocolo ${protocolCode} criado`,
          metadata: { protocol_code: protocolCode, protocol_id: protocolRecord.id }
        });
      } catch (e) { log(`Falha notificacao: ${e.message}`); }

      try {
        const msg = `✅ *Protocolo Gerado*\n\n🔢 *Número:* ${protocolCode}\n\nSeu atendimento foi registrado com sucesso.`;
        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({ conversation_id, content: msg, message_type: 'text' })
        });
      } catch (e) { log(`Falha Z-API: ${e.message}`); }
    }

    // 8. Log Final no Banco (COM PROVIDER)
    try {
      await supabaseClient.from('ai_logs').insert({
        conversation_id,
        status: 'success',
        model: 'create-protocol',
        provider: 'internal',
        input_excerpt: `Resolved via ${source}${notify_group ? ' (notified group)' : ''}`,
        output_text: `Protocol: ${protocolCode}\nLogs: ${logBuffer.join('\n')}`
      });
    } catch (e) { console.error('Falha ao logar em ai_logs:', e.message); }

    return new Response(JSON.stringify({
      success: true,
      protocol_code: protocolCode,
      protocol: {
        ...protocolRecord,
        protocol_code: protocolCode
      },
      data: protocolRecord
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[create-protocol] ERRO FATAL:', error.message);

    try {
      await supabaseClient.from('ai_logs').insert({
        conversation_id: conversation_id_for_log,
        status: 'error',
        error_message: error.message,
        model: 'create-protocol',
        provider: 'internal', // REQUERIDO PELO BANCO
        input_excerpt: logBuffer.join('\n')
      });
    } catch (e) { console.error('Falha ao logar erro em ai_logs:', e.message); }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
