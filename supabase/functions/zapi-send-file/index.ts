import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { conversation_id, file_url, file_name, file_type, caption, sender_id, sender_name } = await req.json();

    console.log('Sending file via Z-API:', { conversation_id, file_type, file_name });

    if (!conversation_id || !file_url) {
      return new Response(JSON.stringify({ error: 'conversation_id and file_url are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get conversation and contact info
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        contacts (
          id,
          phone,
          lid,
          chat_lid,
          is_group
        )
      `)
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.error('Conversation not found:', convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contact = (conversation as any).contacts;

    // ✅ Extract phone and LID properly
    let rawPhone = contact.phone;
    const lid = contact.lid || contact.chat_lid;

    // ✅ Detect if "phone" is actually a LID (14+ digits, no 55 prefix, no @ symbol)
    const phoneIsLid = rawPhone && rawPhone.length >= 14 && !rawPhone.startsWith('55') && !rawPhone.includes('@');

    let recipientPhone: string;

    if (phoneIsLid) {
      // Phone field contains a LID - add @lid suffix
      recipientPhone = `${rawPhone}@lid`;
      console.log('[zapi-send-file] Phone field contains LID, adding @lid suffix:', recipientPhone);
    } else if (rawPhone && !phoneIsLid) {
      // Normal phone number  
      recipientPhone = rawPhone;
    } else if (lid) {
      // No phone, use LID field with @lid suffix if needed
      if (lid.endsWith('@lid')) {
        recipientPhone = lid;
      } else if (lid.length >= 14 && !lid.startsWith('55')) {
        recipientPhone = `${lid}@lid`;
      } else {
        recipientPhone = lid;
      }
    } else {
      // No valid identifier found
      return new Response(JSON.stringify({ error: 'No valid recipient identifier' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[zapi-send-file] Sending to:', recipientPhone);

    // Get Z-API credentials
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const token = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

    if (!instanceId || !token) {
      console.error('Z-API credentials not configured');
      return new Response(JSON.stringify({ error: 'Z-API credentials not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine Z-API endpoint based on file type
    let endpoint = 'send-document';
    let messageType: 'image' | 'video' | 'audio' | 'document' = 'document';

    if (file_type?.startsWith('image/')) {
      endpoint = 'send-image';
      messageType = 'image';
    } else if (file_type?.startsWith('video/')) {
      endpoint = 'send-video';
      messageType = 'video';
    } else if (file_type?.startsWith('audio/')) {
      endpoint = 'send-audio';
      messageType = 'audio';
    } else {
      // ✅ For documents, Z-API requires file extension in URL
      const fileExt = file_name?.split('.').pop() || file_type?.split('/').pop() || 'pdf';
      endpoint = `send-document/${fileExt}`;
    }

    const zapiUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`;

    const zapiPayload: Record<string, string> = {
      phone: recipientPhone,  // Now properly handles phone or LID@lid
    };

    // Different payload structure for different file types
    if (messageType === 'image') {
      zapiPayload.image = file_url;
      if (caption) zapiPayload.caption = caption;
    } else if (messageType === 'video') {
      zapiPayload.video = file_url;
      if (caption) zapiPayload.caption = caption;
    } else if (messageType === 'audio') {
      zapiPayload.audio = file_url;
    } else {
      zapiPayload.document = file_url;
      if (file_name) zapiPayload.fileName = file_name;
    }

    console.log('Calling Z-API:', { endpoint, payload: zapiPayload });

    const zapiHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add client-token if configured
    if (clientToken) {
      zapiHeaders['client-token'] = clientToken;
    }

    const zapiResponse = await fetch(zapiUrl, {
      method: 'POST',
      headers: zapiHeaders,
      body: JSON.stringify(zapiPayload),
    });

    const zapiResult = await zapiResponse.json();
    console.log('Z-API response:', zapiResult);

    if (!zapiResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to send via Z-API', details: zapiResult }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Save message to database
    // ✅ FIX: Added chat_id and ensured sender_id is valid UUID
    const isValidUuid = (uid: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(uid));

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        chat_id: recipientPhone, // ✅ Alinhamento com zapi-send-message
        sender_type: 'agent',
        sender_id: isValidUuid(sender_id) ? sender_id : null,
        agent_name: sender_name || 'Atendente G7',
        sender_name: sender_name || 'Atendente G7',
        message_type: messageType,
        content: caption || file_name || null,
        media_url: file_url,
        whatsapp_message_id: zapiResult.messageId || zapiResult.zapiMessageId,
        sent_at: new Date().toISOString(),
        direction: 'outbound',
        status: 'sent',
        provider: 'zapi'
      })
      .select()
      .single();

    if (msgError) {
      console.error('Error saving message:', msgError);
      return new Response(JSON.stringify({ error: 'Error saving message to database', details: msgError }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update conversation
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversation_id);

    console.log('File message saved:', message.id);

    return new Response(JSON.stringify({
      success: true,
      message_id: message.id,
      zapi_message_id: zapiResult.messageId || zapiResult.zapiMessageId,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send file error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
