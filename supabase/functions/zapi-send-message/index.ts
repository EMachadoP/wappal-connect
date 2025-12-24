import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const zapiInstanceId = Deno.env.get('ZAPI_INSTANCE_ID')!;
const zapiToken = Deno.env.get('ZAPI_TOKEN')!;
const zapiClientToken = Deno.env.get('ZAPI_CLIENT_TOKEN')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { conversation_id, content, message_type, media_url, sender_id, sender_name: providedName } = await req.json();

    const { data: conv } = await supabase.from('conversations').select('*, contacts(*)').eq('id', conversation_id).single();
    if (!conv) throw new Error('Conversa não encontrada');

    const contact = conv.contacts;
    let recipient = conv.chat_id || contact.chat_lid || contact.lid || contact.phone;

    if (!recipient) throw new Error('Destinatário não identificado');

    // NORMALIZAÇÃO: Se for número de telefone (não grupo), remover tudo que não for dígito
    if (!recipient.includes('@g.us') && !recipient.includes('-')) {
      recipient = recipient.replace(/\D/g, '');
    }

    let senderName = providedName || 'G7';
    if (!providedName && sender_id) {
      const { data: profile } = await supabase.from('profiles').select('name').eq('id', sender_id).single();
      if (profile?.name) senderName = profile.name;
    }

    const prefixedContent = `*${senderName}:*\n${content}`;
    const zapiBaseUrl = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}`;
    
    let endpoint = '/send-text';
    let body: any = { phone: recipient, message: prefixedContent };

    if (message_type === 'image') { endpoint = '/send-image'; body = { phone: recipient, image: media_url, caption: prefixedContent }; }
    else if (message_type === 'audio') { endpoint = '/send-audio'; body = { phone: recipient, audio: media_url }; }
    else if (message_type === 'video') { endpoint = '/send-video'; body = { phone: recipient, video: media_url, caption: prefixedContent }; }
    else if (message_type === 'document') { endpoint = '/send-document'; body = { phone: recipient, document: media_url, fileName: content }; }

    const response = await fetch(`${zapiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': zapiClientToken },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Erro no Z-API');

    await supabase.from('messages').insert({
      conversation_id,
      sender_type: 'agent',
      sender_id: sender_id || null,
      agent_name: senderName,
      content,
      message_type: message_type || 'text',
      media_url,
      sent_at: new Date().toISOString(),
      provider: 'zapi',
      provider_message_id: result.messageId || result.zapiMessageId,
      status: 'sent'
    });

    await supabase.from('conversations').update({ last_message_at: new Date().toISOString(), unread_count: 0 }).eq('id', conversation_id);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Send error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});