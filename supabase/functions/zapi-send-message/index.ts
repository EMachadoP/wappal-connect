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
    // 1. Identificar o usuário através do JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado: Cabeçalho ausente');

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Token inválido ou expirado');

    // 2. Verificar se o usuário tem permissão (Agente ou Admin)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!roleData || !['admin', 'agent'].includes(roleData.role)) {
      throw new Error('Acesso negado: Requer privilégios de agente');
    }

    // 3. Obter dados seguros do perfil (não confiamos no nome enviado pelo cliente)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name, display_name')
      .eq('id', user.id)
      .single();

    const senderName = profile?.display_name || profile?.name || 'G7';

    // 4. Processar o envio
    const { conversation_id, content, message_type, media_url } = await req.json();
    
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', conversation_id)
      .single();

    if (!conv) throw new Error('Conversa não encontrada');

    // Buscar credenciais Z-API
    const { data: settings } = await supabaseAdmin.from('zapi_settings').select('*').limit(1).single();
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID') || settings?.zapi_instance_id;
    const token = Deno.env.get('ZAPI_TOKEN') || settings?.zapi_token;
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') || settings?.zapi_security_token;

    if (!instanceId || !token) throw new Error('Credenciais Z-API não configuradas');

    const recipient = conv.contacts?.lid || conv.chat_id || conv.contacts?.phone;
    if (!recipient) throw new Error('Destinatário inválido');

    // Prefixo com o nome do atendente para clareza no WhatsApp
    const prefixedContent = `*${senderName}:*\n${content}`;
    const zapiBaseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    
    let endpoint = '/send-text';
    let body: any = { phone: recipient, message: prefixedContent };

    if (message_type === 'image') { endpoint = '/send-image'; body = { phone: recipient, image: media_url, caption: prefixedContent }; }
    else if (message_type === 'audio') { endpoint = '/send-audio'; body = { phone: recipient, audio: media_url }; }
    else if (message_type === 'video') { endpoint = '/send-video'; body = { phone: recipient, video: media_url, caption: prefixedContent }; }
    else if (message_type === 'document') { endpoint = '/send-document'; body = { phone: recipient, document: media_url, fileName: content }; }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (clientToken) headers['Client-Token'] = clientToken;

    const response = await fetch(`${zapiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Erro no provedor WhatsApp');

    // 5. Salvar log com o ID do usuário real (extraído do JWT)
    await supabaseAdmin.from('messages').insert({
      conversation_id,
      sender_type: 'agent',
      sender_id: user.id, // ID VALIDADO
      agent_name: senderName,
      content,
      message_type: message_type || 'text',
      media_url,
      sent_at: new Date().toISOString(),
      provider: 'zapi',
      provider_message_id: result.messageId || result.zapiMessageId,
      status: 'sent'
    });

    await supabaseAdmin.from('conversations').update({ 
      last_message_at: new Date().toISOString(), 
      unread_count: 0 
    }).eq('id', conversation_id);

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[Send Message Security Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: error.message.includes('Acesso negado') ? 403 : 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});