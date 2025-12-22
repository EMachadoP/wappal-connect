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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { conversation_id, content, message_type = 'text', media_url, sender_id } = await req.json();

    if (!conversation_id || (!content && !media_url)) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Sending message:', { conversation_id, message_type, hasContent: !!content, hasMedia: !!media_url, sender_id });

    // Get sender name if sender_id provided
    let senderName: string | null = null;
    if (sender_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', sender_id)
        .single();
      
      if (profile?.name) {
        senderName = profile.name;
      }
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
    
    // Determine recipient: prefer LID, fallback to phone
    let recipient = contact.lid || contact.phone;
    
    if (!recipient) {
      return new Response(JSON.stringify({ error: 'No valid recipient (LID or phone)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Sending to recipient:', recipient, 'Sender:', senderName);

    // Z-API base URL
    const zapiBaseUrl = `https://api.z-api.io/instances/${zapiInstanceId}/token/${zapiToken}`;

    let zapiResponse;
    let zapiEndpoint: string;
    let zapiBody: Record<string, unknown>;

    // Prefix message with agent name if available
    const prefixedContent = senderName && content 
      ? `*${senderName}:* ${content}` 
      : content;

    // Build request based on message type
    switch (message_type) {
      case 'image':
        zapiEndpoint = '/send-image';
        zapiBody = {
          phone: recipient,
          image: media_url,
          caption: prefixedContent || '',
        };
        break;
      case 'video':
        zapiEndpoint = '/send-video';
        zapiBody = {
          phone: recipient,
          video: media_url,
          caption: prefixedContent || '',
        };
        break;
      case 'audio':
        zapiEndpoint = '/send-audio';
        zapiBody = {
          phone: recipient,
          audio: media_url,
        };
        break;
      case 'document':
        zapiEndpoint = '/send-document';
        zapiBody = {
          phone: recipient,
          document: media_url,
          fileName: content || 'document',
        };
        break;
      default:
        zapiEndpoint = '/send-text';
        zapiBody = {
          phone: recipient,
          message: prefixedContent,
        };
    }

    console.log('Z-API request:', { endpoint: zapiEndpoint, body: zapiBody });

    // Send to Z-API
    zapiResponse = await fetch(`${zapiBaseUrl}${zapiEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': zapiClientToken,
      },
      body: JSON.stringify(zapiBody),
    });

    const zapiResult = await zapiResponse.json();
    console.log('Z-API response:', zapiResult);

    if (!zapiResponse.ok) {
      // If LID fails, try with phone as fallback
      if (contact.lid && contact.phone && recipient === contact.lid) {
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

        const fallbackResult = await fallbackResponse.json();
        console.log('Z-API fallback response:', fallbackResult);

        if (!fallbackResponse.ok) {
          return new Response(JSON.stringify({ error: 'Failed to send message', details: fallbackResult }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        Object.assign(zapiResult, fallbackResult);
      } else {
        return new Response(JSON.stringify({ error: 'Failed to send message', details: zapiResult }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Save message to database
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation_id,
        sender_type: 'agent',
        sender_id: sender_id || null,
        message_type: message_type,
        content: content,
        media_url: media_url || null,
        whatsapp_message_id: zapiResult.messageId || zapiResult.zapiMessageId || null,
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (msgError) {
      console.error('Error saving message:', msgError);
      throw msgError;
    }

    // Update conversation last_message_at
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq('id', conversation_id);

    console.log('Message saved:', message.id);

    return new Response(JSON.stringify({ 
      success: true, 
      message_id: message.id,
      whatsapp_message_id: zapiResult.messageId || zapiResult.zapiMessageId,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send message error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
