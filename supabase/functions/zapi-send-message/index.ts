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
    // 1. Validar Autenticação do Usuário (auth.uid)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado: Token ausente');

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Sessão expirada ou inválida');

    // 2. Validar Role e Status do Agente usando Service Role (Admin)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, name, display_name, is_active')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile || !profile.is_active) {
      throw new Error('Agente inativo ou não autorizado para enviar mensagens');
    }

    const { data: roleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!roleData || !['admin', 'agent'].includes(roleData.role)) {
      throw new Error('Permissão insuficiente: Requer role de agente ou admin');
    }

    // 3. Processar Payload e Validar Destinatário
    const { conversation_id, content, message_type, media_url } = await req.json();
    
    const { data: conv, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select('id, chat_id, contacts(phone, lid)')
      .eq('id', conversation_id)
      .single();

    if (convErr || !conv) throw new Error('Conversa inválida ou não encontrada');

    // 4. Obter Credenciais Z-API
    const { data: settings } = await supabaseAdmin.from('zapi_settings').select('*').limit(1).single();
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID') || settings?.zapi_instance_id;
    const token = Deno.env.get('ZAPI_TOKEN') || settings?.zapi_token;
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') || settings?.zapi_security_token;

    if (!instanceId || !token) throw new Error('Configurações de integração WhatsApp pendentes');

    // deno-lint-ignore no-explicit-any
    const contact = conv.contacts as any;
    const recipient = contact?.lid || conv.chat_id || contact?.phone;
    if (!recipient) throw new Error('Identificador do contato ausente');

    const senderName = profile.display_name || profile.name || 'Atendente';
    const prefixedContent = `*${senderName}:*\n${content}`;
    const zapiBaseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    
    let endpoint = '/send-text';
    // deno-lint-ignore no-explicit-any
    let body: any = { phone: recipient, message: prefixedContent };

    if (message_type === 'image') { 
      endpoint = '/send-image'; 
      body = { phone: recipient, image: media_url, caption: prefixedContent }; 
    } else if (message_type === 'audio') { 
      endpoint = '/send-audio'; 
      body = { phone: recipient, audio: media_url }; 
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (clientToken) headers['Client-Token'] = clientToken;

    // 5. Enviar Mensagem
    const response = await fetch(`${zapiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Erro no envio via WhatsApp');

    // 6. Registrar Mensagem no DB
    await supabaseAdmin.from('messages').insert({
      conversation_id,
      sender_type: 'agent',
      sender_id: user.id,
      agent_name: senderName,
      content,
      message_type: message_type || 'text',
      media_url,
      provider: 'zapi',
      provider_message_id: result.messageId || result.zapiMessageId,
      status: 'sent',
      direction: 'outbound',
      sent_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[Send Message Security Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 401, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});