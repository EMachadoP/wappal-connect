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
    if (!authHeader) throw new Error('Não autorizado');

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) throw new Error('Sessão inválida');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (!roleData || !['admin', 'agent'].includes(roleData.role)) throw new Error('Permissão insuficiente');

    const { conversation_id, file_url, file_name, file_type, caption } = await req.json();
    
    const { data: conv } = await supabaseAdmin.from('conversations').select('id, chat_id, contacts(phone, lid)').eq('id', conversation_id).single();
    if (!conv) throw new Error('Conversa não encontrada');

    const { data: settings } = await supabaseAdmin.from('zapi_settings').select('*').limit(1).single();
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID') || settings?.zapi_instance_id;
    const token = Deno.env.get('ZAPI_TOKEN') || settings?.zapi_token;

    // deno-lint-ignore no-explicit-any
    const contact = conv.contacts as any;
    const recipient = contact?.lid || conv.chat_id || contact?.phone;

    let endpoint = 'send-document';
    let messageType: 'image' | 'video' | 'audio' | 'document' = 'document';
    if (file_type?.startsWith('image/')) { endpoint = 'send-image'; messageType = 'image'; }
    else if (file_type?.startsWith('video/')) { endpoint = 'send-video'; messageType = 'video'; }
    else if (file_type?.startsWith('audio/')) { endpoint = 'send-audio'; messageType = 'audio'; }

    const zapiResponse = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: recipient, [messageType === 'document' ? 'document' : messageType]: file_url, caption, fileName: file_name }),
    });

    const result = await zapiResponse.json();
    if (!zapiResponse.ok) throw new Error('Erro Z-API');

    await supabaseAdmin.from('messages').insert({
      conversation_id,
      sender_type: 'agent',
      sender_id: user.id,
      message_type: messageType,
      content: caption || file_name,
      media_url: file_url,
      provider_message_id: result.messageId || result.zapiMessageId,
      sent_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});