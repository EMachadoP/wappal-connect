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
      .select('id, active_condominium_id, contact_id, contacts(name, role, condominium_id)')
      .eq('id', conversation_id)
      .maybeSingle();

    if (convError) throw new Error(`Erro ao buscar conversa: ${convError.message}`);
    if (!conv) throw new Error(`Conversa ${conversation_id} não encontrada.`);

    const contact = conv.contacts as any;

    // 5. Resolução de Condomínio
    let resolvedCondoId = null;
    let source = 'none';

    if (condominium_id && isValidUUID(condominium_id)) {
      resolvedCondoId = condominium_id;
      source = 'input_direct';
    }

    if (!resolvedCondoId) {
      resolvedCondoId = conv.active_condominium_id || contact?.condominium_id;
      if (resolvedCondoId) source = 'conversation_or_contact';
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

    // 6. Criar Protocolo
    const protocolCode = `PROT-${Date.now()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    log(`[create-protocol] Criando ${protocolCode} via ${source}...`);

    const { data: protocolRecord, error: protocolError } = await supabaseClient
      .from('protocols')
      .insert({
        protocol_code: protocolCode,
        conversation_id,
        condominium_id: resolvedCondoId,
        participant_id: isValidUUID(participant_id) ? participant_id : null,
        category: category || 'operational',
        priority: priority || 'normal',
        summary: summary || 'Gerado via sistema',
        status: 'open',
        created_by_agent_id: isValidUUID(created_by_agent_id) ? created_by_agent_id : null,
        created_by_type: created_by_agent_id ? 'agent' : 'ai',
        requester_name: requester_name || contact?.name || 'Não informado',
        requester_role: requester_role || contact?.role || 'Morador',
        apartment: apartment
      })
      .select()
      .single();

    if (protocolError) throw new Error(`Erro ao inserir protocolo: ${protocolError.message}`);

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
          const { data: condoData } = await supabaseClient.from('condominiums').select('name').eq('id', resolvedCondoId).maybeSingle();
          if (condoData) condoName = condoData.name;
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
            requester_role: requester_role || contact?.role || 'Morador'
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
