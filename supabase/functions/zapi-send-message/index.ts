import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  try {
    const authHeader = req.headers.get('Authorization');
    // Permitir chamada interna com service key OU chamada de cliente com token de usuário
    const isServiceKey = authHeader?.includes(supabaseServiceKey);
    let userId = 'system';
    
    if (!isServiceKey) {
      if (!authHeader) throw new Error('Não autorizado: Sessão ausente');
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) throw new Error('Sessão expirada ou inválida');
      userId = user.id;
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Obter nome do atendente
    let senderName = 'Atendente G7';
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
      // Se for chamada de sistema (IA), usar nome do agente de IA configurado ou padrão
      senderName = 'Ana Mônica (IA)';
    }

    const { conversation_id, content, message_type, media_url, sender_name: overrideSenderName } = await req.json();
    
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
      throw new Error(result.message || 'Falha na API do WhatsApp');
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

    // Atualizar conversa
    await supabaseAdmin.from('conversations').update({
      last_message_at: new Date().toISOString(),
      // Se IA respondeu, talvez queira marcar algo? Por enquanto não.
    }).eq('id', conversation_id);

    return new Response(JSON.stringify({ success: true, messageId: result.messageId }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error: any) {
    console.error('[Send Message Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});