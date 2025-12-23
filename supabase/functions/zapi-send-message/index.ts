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

// Generate a unique client message ID
function generateClientMessageId(): string {
  return `client_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { conversation_id, content, message_type = 'text', media_url, sender_id, client_message_id: providedClientId, sender_name: providedSenderName } = await req.json();

    if (!conversation_id || (!content && !media_url)) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate or use provided client_message_id for idempotency
    const clientMessageId = providedClientId || generateClientMessageId();

    // IDEMPOTENCY CHECK: Check if message with this client_message_id already exists
    const { data: existingMessage } = await supabase
      .from('messages')
      .select('id, provider_message_id, status')
      .eq('client_message_id', clientMessageId)
      .maybeSingle();

    if (existingMessage) {
      console.log('Message already exists with client_message_id:', clientMessageId);
      return new Response(JSON.stringify({ 
        success: true, 
        duplicate: true,
        message_id: existingMessage.id,
        provider_message_id: existingMessage.provider_message_id,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Sending message:', { conversation_id, message_type, clientMessageId, sender_id, providedSenderName });

    // Get sender name - priority: providedSenderName > profile name lookup > "G7"
    let senderName: string | null = providedSenderName || null;
    let agentId: string | null = sender_id || null;
    
    // If no providedSenderName but we have sender_id, look up the profile
    if (!senderName && sender_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', sender_id)
        .single();
      
      if (profile?.name) {
        senderName = profile.name;
      }
    }
    
    // Fallback to "G7" if still no name
    if (!senderName) {
      senderName = 'G7';
    }

    // Get conversation and contact
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.error('Conversation not found:', convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contact = conversation.contacts;
    const chatId = conversation.chat_id || contact.chat_lid;
    const isGroup = contact.is_group || false;
    
    // For groups, use chat_id/chat_lid as recipient; for individuals, use lid/phone
    let recipient: string | null = null;
    if (isGroup) {
      recipient = chatId || contact.lid;
    } else {
      recipient = contact.lid || contact.phone;
    }
    
    if (!recipient) {
      console.error('No valid recipient found:', { isGroup, chatId, lid: contact.lid, phone: contact.phone });
      return new Response(JSON.stringify({ error: 'No valid recipient (group chat_id or contact LID/phone)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Recipient determined:', { isGroup, recipient });

    // SAVE MESSAGE FIRST with status='queued' (before sending to Z-API)
    const { data: savedMessage, error: saveError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation_id,
        sender_type: 'agent',
        sender_id: sender_id || null,
        agent_id: agentId,
        agent_name: senderName,
        message_type: message_type,
        content: content,
        media_url: media_url || null,
        provider: 'zapi',
        client_message_id: clientMessageId,
        chat_id: chatId,
        direction: 'outbound',
        status: 'queued',
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (saveError) {
      // Check for duplicate constraint
      if (saveError.code === '23505') {
        console.log('Duplicate message via constraint:', clientMessageId);
        return new Response(JSON.stringify({ success: true, duplicate: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('Error saving message:', saveError);
      throw saveError;
    }

    console.log('Message queued:', savedMessage.id, 'client_message_id:', clientMessageId);

    // Z-API base URL
    const zapiBaseUrl = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}`;

    // Prefix message with agent name (always, for consistency in WhatsApp)
    // Only add prefix if content doesn't already start with *Name:*
    let prefixedContent = content;
    if (content && senderName) {
      const prefixPattern = /^\*[^*]+:\*\s*/;
      if (!prefixPattern.test(content)) {
        prefixedContent = `*${senderName}:*\n${content}`;
      }
    }

    let zapiEndpoint: string;
    let zapiBody: Record<string, unknown>;

    switch (message_type) {
      case 'image':
        zapiEndpoint = '/send-image';
        zapiBody = { phone: recipient, image: media_url, caption: prefixedContent || '' };
        break;
      case 'video':
        zapiEndpoint = '/send-video';
        zapiBody = { phone: recipient, video: media_url, caption: prefixedContent || '' };
        break;
      case 'audio':
        zapiEndpoint = '/send-audio';
        zapiBody = { phone: recipient, audio: media_url };
        break;
      case 'document':
        zapiEndpoint = '/send-document';
        zapiBody = { phone: recipient, document: media_url, fileName: content || 'document' };
        break;
      default:
        zapiEndpoint = '/send-text';
        zapiBody = { phone: recipient, message: prefixedContent };
    }

    console.log('Z-API request:', { endpoint: zapiEndpoint, body: zapiBody });

    // Send to Z-API
    let zapiResponse = await fetch(`${zapiBaseUrl}${zapiEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': zapiClientToken,
      },
      body: JSON.stringify(zapiBody),
    });

    let zapiResult = await zapiResponse.json();
    console.log('Z-API response:', zapiResult);

    // Fallback to phone if LID fails
    if (!zapiResponse.ok && contact.lid && contact.phone && recipient === contact.lid) {
      console.log('LID failed, trying phone fallback...');
      zapiBody.phone = contact.phone;
      
      const fallbackResponse = await fetch(`${zapiBaseUrl}${zapiEndpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Token': zapiClientToken,
        },
        body: JSON.stringify(zapiBody),
      });

      zapiResult = await fallbackResponse.json();
      console.log('Z-API fallback response:', zapiResult);

      if (!fallbackResponse.ok) {
        // Update message status to failed
        await supabase
          .from('messages')
          .update({ status: 'failed' })
          .eq('id', savedMessage.id);
        
        return new Response(JSON.stringify({ error: 'Failed to send message', details: zapiResult }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else if (!zapiResponse.ok) {
      // Update message status to failed
      await supabase
        .from('messages')
        .update({ status: 'failed' })
        .eq('id', savedMessage.id);
      
      return new Response(JSON.stringify({ error: 'Failed to send message', details: zapiResult }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract provider_message_id from Z-API response
    const providerMessageId = zapiResult.messageId || zapiResult.zapiMessageId || null;

    // UPDATE MESSAGE with provider_message_id and status='sent'
    await supabase
      .from('messages')
      .update({
        provider_message_id: providerMessageId,
        whatsapp_message_id: providerMessageId,
        status: 'sent',
      })
      .eq('id', savedMessage.id);

    // Update conversation last_message_at
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq('id', conversation_id);

    console.log('Message sent successfully:', savedMessage.id, 'provider_message_id:', providerMessageId);

    return new Response(JSON.stringify({ 
      success: true, 
      message_id: savedMessage.id,
      client_message_id: clientMessageId,
      provider_message_id: providerMessageId,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send message error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      error: errorMessage, 
      details: error instanceof Error ? { stack: error.stack } : null 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
