import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Initialize admin client early so it's available in catch block
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Declare variables outside try so they're accessible in catch
  let userId = 'system';
  let conversation_id: string | undefined, content: string | undefined, senderName: string | undefined;

  try {
    const authHeader = req.headers.get('Authorization');
    // Permitir chamada interna com service key OU chamada de cliente com token de usuário
    const isServiceKey = authHeader?.includes(supabaseServiceKey);

    if (!isServiceKey) {
      if (!authHeader) throw new Error('Não autorizado: Sessão ausente');
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) throw new Error('Sessão expirada ou inválida');
      userId = user.id;
    }

    // Obter nome do atendente
    senderName = 'Atendente G7';
    if (userId !== 'system') {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('name, display_name')
        .eq('id', userId)
        .single();
      if (profile) {
        senderName = profile.display_name || profile.name || 'Atendente G7';
      }
    } else {
      senderName = 'Ana Mônica (IA)';
    }

    const json = await req.json();
    ({ conversation_id, content } = json);
    const { message_type, media_url, sender_name: overrideSenderName } = json;

    if (overrideSenderName) senderName = overrideSenderName;

    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', conversation_id)
      .single();

    if (!conv) throw new Error('Conversa não localizada no banco');

    // Credenciais - Tenta Env Var primeiro, depois banco
    const { data: settings } = await supabaseAdmin.from('zapi_settings').select('*').limit(1).single();

    // Prioridade: Env Var > Banco
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID') || settings?.zapi_instance_id;
    const token = Deno.env.get('ZAPI_TOKEN') || settings?.zapi_token;
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') || settings?.zapi_security_token;

    if (!instanceId || !token) {
      console.error('[Send Message] Erro: Faltam credenciais ZAPI (Instance ou Token)');
      throw new Error('Configurações de WhatsApp incompletas no servidor');
    }

    // Determinar destinatário
    const contact = conv.contacts;
    let recipient = conv.chat_id;

    // Fallbacks para garantir envio
    if (!recipient && contact) {
      recipient = contact.chat_lid || contact.phone || contact.lid;
    }

    if (!recipient) throw new Error('O destinatário não possui um identificador válido (Phone/LID)');

    console.log(`[Send Message] Enviando para ${recipient} via instância ${instanceId}`);

    // Formatar mensagem
    // Se for áudio, não adiciona prefixo de nome
    let finalContent = content;
    let endpoint = '/send-text';
    let body: any = { phone: recipient };

    if (message_type === 'text') {
      // Adicionar nome do remetente apenas se não for IA automática (opcional, aqui estamos colocando sempre)
      // Mas para IA (system), às vezes queremos parecer mais natural
      if (userId !== 'system' || overrideSenderName) {
        finalContent = `*${senderName}:*\n${content}`;
      }
      body.message = finalContent;
    } else if (message_type === 'image') {
      endpoint = '/send-image';
      body.image = media_url;
      body.caption = content ? `*${senderName}:*\n${content}` : '';
    } else if (message_type === 'audio') {
      endpoint = '/send-audio';
      body.audio = media_url;
    } else if (message_type === 'document' || message_type === 'file') {
      endpoint = '/send-document';
      body.document = media_url;
      // Tentar extrair extensão/nome se possível, ou usar padrão
      body.fileName = 'documento';
    }

    const zapiBaseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (clientToken) headers['Client-Token'] = clientToken;

    const response = await fetch(`${zapiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error('[Z-API Error]', result);
      throw new Error(`Falha Z-API (${response.status}): ${JSON.stringify(result)}`);
    }

    // Salvar registro no banco
    await supabaseAdmin.from('messages').insert({
      conversation_id,
      sender_type: userId === 'system' ? 'agent' : 'agent', // 'agent' para ambos visualmente
      sender_id: userId === 'system' ? null : userId,
      agent_name: senderName,
      content: content, // Salvar conteúdo original sem prefixo no banco
      message_type: message_type || 'text',
      media_url,
      sent_at: new Date().toISOString(),
      provider: 'zapi',
      provider_message_id: result.messageId || result.zapiMessageId,
      status: 'sent',
      direction: 'outbound'
    });

    // AUTO-PAUSE AI: Se um humano (não system) enviou mensagem, pausar IA por 30min
    if (userId && userId !== 'system') {
      console.log('[Auto-Pause] Human operator sent message, pausing AI for 30min');

      const pauseUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

      await supabaseAdmin
        .from('conversations')
        .update({
          human_control: true,
          ai_mode: 'OFF',
          ai_paused_until: pauseUntil.toISOString(),
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation_id);

      // Log evento
      await supabaseAdmin.from('ai_events').insert({
        conversation_id,
        event_type: 'human_intervention',
        message: '👤 Operador assumiu conversa. IA pausada por 30min.',
        metadata: {
          user_id: userId,
          paused_until: pauseUntil.toISOString(),
        },
      });

      // SLA TRACKING: Register first_response_at on protocols that don't have it yet
      // This is the first human response after protocol creation
      const now = new Date().toISOString();
      const { data: updatedProtocols } = await supabaseAdmin
        .from('protocols')
        .update({ first_response_at: now })
        .eq('conversation_id', conversation_id)
        .is('first_response_at', null)
        .select('id, protocol_code');

      if (updatedProtocols && updatedProtocols.length > 0) {
        console.log(`[SLA] First response recorded for ${updatedProtocols.length} protocol(s):`,
          updatedProtocols.map(p => p.protocol_code).join(', '));
      }
    } else {
      // Apenas atualizar timestamp se for IA
      await supabaseAdmin.from('conversations').update({
        last_message_at: new Date().toISOString(),
      }).eq('id', conversation_id);
    }

    return new Response(JSON.stringify({ success: true, messageId: result.messageId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[Send Message Error]', error.message);

    // Log detalhado no banco para debug remoto (com proteção contra crash)
    try {
      await supabaseAdmin.from('ai_logs').insert({
        function_name: 'zapi-send-message',
        input_data: { conversation_id: conversation_id || null, content: content || null, userId: userId || 'unknown' },
        output_data: {},
        error_message: error.message + (error.stack ? ` | ${error.stack}` : ''),
        execution_time: 0
      });
    } catch (logError) {
      console.error('[Failed to log error]', logError);
    }

    return new Response(JSON.stringify({ error: error.message, details: error }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});