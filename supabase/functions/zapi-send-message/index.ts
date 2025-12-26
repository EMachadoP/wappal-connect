import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, client-token',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Unauthorized');

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Invalid session');

    // Use service role client to access settings securely
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name, display_name, team_id')
      .eq('id', user.id)
      .single();

    const { conversation_id, content, message_type, media_url } = await req.json();
    
    // Fetch conversation with contact info
    const { data: conv, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select('id, chat_id, contacts(phone, lid, chat_lid)')
      .eq('id', conversation_id)
      .single();

    if (convErr || !conv) throw new Error('Conversation not found');

    // Fetch Z-API settings securely via service role
    // Prefer team settings, then global
    let zapiSettings = null;
    if (profile?.team_id) {
      const { data } = await supabaseAdmin.from('zapi_settings').select('*').eq('team_id', profile.team_id).maybeSingle();
      zapiSettings = data;
    }
    
    if (!zapiSettings) {
      const { data } = await supabaseAdmin.from('zapi_settings').select('*').is('team_id', null).maybeSingle();
      zapiSettings = data;
    }

    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID') || zapiSettings?.zapi_instance_id;
    const token = Deno.env.get('ZAPI_TOKEN') || zapiSettings?.zapi_token;
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') || zapiSettings?.zapi_security_token;

    if (!instanceId || !token) throw new Error('WhatsApp API not configured');

    const contact = conv.contacts as any;
    const recipient = contact?.chat_lid || contact?.lid || conv.chat_id || contact?.phone;
    
    if (!recipient) throw new Error('Recipient identifier missing');

    const senderName = profile?.display_name || profile?.name || 'G7 Agent';
    const messageContent = `*${senderName}:*\n${content}`;
    
    let endpoint = '/send-text';
    let body: any = { phone: recipient, message: messageContent };

    if (message_type === 'image') {
      endpoint = '/send-image';
      body = { phone: recipient, image: media_url, caption: messageContent };
    } else if (message_type === 'audio') {
      endpoint = '/send-audio';
      body = { phone: recipient, audio: media_url };
    }

    const response = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}${endpoint}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(clientToken ? { 'Client-Token': clientToken } : {})
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'WhatsApp API Error');

    // Audit log message
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

  } catch (error: any) {
    console.error('[zapi-send-message] Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});