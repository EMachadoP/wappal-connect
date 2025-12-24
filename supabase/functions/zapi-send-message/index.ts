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
    if (!authHeader) throw new Error('Não autorizado: Sessão ausente');

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Sessão expirada ou inválida');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Obter nome do atendente
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name, display_name')
      .eq('id', user.id)
      .single();

    const senderName = profile?.display_name || profile?.name || 'Atendente G7';

    const { conversation_id, content, message_type, media_url } = await req.json();
    
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', conversation_id)
      .single();

    if (!conv) throw new Error('Conversa não localizada no banco');

    // Credenciais
    const { data: settings } = await supabaseAdmin.from('zapi_settings').select('*').limit(1).single();
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID') || settings?.zapi_instance_id;
    const token = Deno.env.get('ZAPI_TOKEN') || settings?.zapi_token;
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') || settings?.zapi_security_token;

    if (!instanceId || !token) {
      console.error('[Send Message] Erro: Faltam credenciais ZAPI (Instance ou Token)');
      throw new Error('Configurações de WhatsApp incompletas no servidor');
    }

    const recipient = conv.contacts?.lid || conv.chat_id || conv.contacts?.phone;
    if (!recipient) throw new Error('O destinatário não possui um identificador válido (Phone/LID)');

    console.log(`[Send Message] Enviando para ${recipient} via instância ${instanceId}`);

    const prefixedContent = `*${senderName}:*\n${content}`;
    const zapiBaseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    
    let endpoint = '/send-text';
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

    // Salvar registro
    await supabaseAdmin.from('messages').insert({
      conversation_id,
      sender_type: 'agent',
      sender_id: user.id,
      agent_name: senderName,
      content,
      message_type: message_type || 'text',
      media_url,
      sent_at: new Date().toISOString(),
      provider: 'zapi',
      provider_message_id: result.messageId || result.zapiMessageId,
      status: 'sent',
      direction: 'outbound'
    });

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[Send Message Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});