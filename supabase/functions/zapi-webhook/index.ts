import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zapi-token',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate webhook authentication
    // Z-API can send token via x-zapi-token header OR Client-Token header
    const zapiToken = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');
    
    const requestZapiToken = req.headers.get('x-zapi-token') || req.headers.get('X-ZAPI-Token');
    const requestClientToken = req.headers.get('client-token') || req.headers.get('Client-Token');
    
    // Validate: accept if either token matches
    const isValidZapiToken = zapiToken && requestZapiToken && requestZapiToken === zapiToken;
    const isValidClientToken = clientToken && requestClientToken && requestClientToken === clientToken;
    
    // Only require authentication if tokens are configured AND request doesn't match
    if ((zapiToken || clientToken) && !isValidZapiToken && !isValidClientToken) {
      // Log more details for debugging
      console.log('Token validation failed:', {
        hasZapiToken: !!zapiToken,
        hasClientToken: !!clientToken,
        receivedZapiToken: !!requestZapiToken,
        receivedClientToken: !!requestClientToken,
      });
      
      // If no tokens were sent, just warn but allow (Z-API default config doesn't send tokens)
      if (!requestZapiToken && !requestClientToken) {
        console.log('Warning: No authentication token received from Z-API. Consider configuring webhook security.');
      } else {
        console.log('Invalid webhook token - rejecting request');
        return new Response(
          JSON.stringify({ error: 'Unauthorized webhook request' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (isValidZapiToken || isValidClientToken) {
      console.log('Webhook token validated successfully');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const payload = await req.json();
    
    console.log('Z-API Webhook received:', JSON.stringify(payload, null, 2));

    // Z-API message structure
    const {
      phone,
      chatLid,
      isGroup,
      messageId,
      fromMe,
      type,
      text,
      image,
      video,
      audio,
      document,
      contact,
      senderName,
      senderPhoto,
      timestamp,
      participantPhone,
      participantLid,
      participantName,
      chatName,
    } = payload;

    // Skip messages sent by us
    if (fromMe) {
      console.log('Skipping own message');
      return new Response(JSON.stringify({ success: true, skipped: 'from_me' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine if group and extract identifiers
    const isGroupChat = Boolean(isGroup);
    
    // For groups: use the group chat as the "contact", individual sender stored in message
    // For individual: use the sender as the contact
    let contactLid: string | null = null;
    let contactPhone: string | null = null;
    let contactName: string;
    let contactPhoto: string | null = null;
    let groupName: string | null = null;

    if (isGroupChat) {
      // Group message: contact is the group itself
      const isLid = phone?.includes('@lid') || chatLid?.includes('@lid');
      contactLid = isLid ? (phone || chatLid) : null;
      contactPhone = null; // Groups don't have phone numbers
      contactName = chatName || senderName || 'Grupo';
      groupName = chatName || contactName;
      contactPhoto = null;
      console.log('Processing GROUP message:', { contactLid, groupName, participantName });
    } else {
      // Individual message
      const isLid = phone?.includes('@lid');
      contactLid = isLid ? phone : contact?.lid || null;
      contactPhone = isLid ? null : phone?.replace(/\D/g, '') || null;
      contactName = senderName || contact?.name || contactPhone || contactLid || 'Contato Desconhecido';
      contactPhoto = senderPhoto || contact?.profilePicture || null;
      console.log('Processing INDIVIDUAL message:', { contactLid, contactPhone, contactName });
    }

    // Find or create contact/group
    let contactRecord;
    
    // Try to find by LID first
    if (contactLid) {
      const { data: existingByLid } = await supabase
        .from('contacts')
        .select('*')
        .eq('lid', contactLid)
        .single();
      
      contactRecord = existingByLid;
    }
    
    // If not found and has phone, try by phone
    if (!contactRecord && contactPhone) {
      const { data: existingByPhone } = await supabase
        .from('contacts')
        .select('*')
        .eq('phone', contactPhone)
        .single();
      
      contactRecord = existingByPhone;
    }

    // Create new contact if not found
    if (!contactRecord) {
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          lid: contactLid,
          phone: contactPhone,
          chat_lid: chatLid || null,
          name: contactName,
          profile_picture_url: contactPhoto,
          lid_source: 'zapi_webhook',
          lid_collected_at: new Date().toISOString(),
          is_group: isGroupChat,
          group_name: groupName,
          whatsapp_display_name: senderName || null,
        })
        .select()
        .single();
      
      if (contactError) {
        console.error('Error creating contact:', contactError);
        throw contactError;
      }
      
      contactRecord = newContact;
      console.log('Created new contact/group:', contactRecord.id, { isGroup: isGroupChat });
    } else {
      // Update contact with latest info
      const updates: Record<string, unknown> = {};
      
      if (contactLid && !contactRecord.lid) {
        updates.lid = contactLid;
        updates.lid_source = 'zapi_webhook';
        updates.lid_collected_at = new Date().toISOString();
      }
      if (contactPhone && !contactRecord.phone) {
        updates.phone = contactPhone;
      }
      if (chatLid && !contactRecord.chat_lid) {
        updates.chat_lid = chatLid;
      }
      if (contactName && contactRecord.name === 'Contato Desconhecido') {
        updates.name = contactName;
      }
      if (contactPhoto && !contactRecord.profile_picture_url) {
        updates.profile_picture_url = contactPhoto;
      }
      if (isGroupChat && !contactRecord.is_group) {
        updates.is_group = true;
        updates.group_name = groupName;
      }
      // Update whatsapp_display_name if different
      if (senderName && senderName !== contactRecord.whatsapp_display_name) {
        updates.whatsapp_display_name = senderName;
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('contacts')
          .update(updates)
          .eq('id', contactRecord.id);
        console.log('Updated contact with:', updates);
      }
    }

    // Find or create conversation - ONE conversation per contact/group (like WhatsApp)
    let { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('contact_id', contactRecord.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (!conversation) {
      const { data: newConversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactRecord.id,
          status: 'open',
          unread_count: 1,
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (convError) {
        console.error('Error creating conversation:', convError);
        throw convError;
      }
      
      conversation = newConversation;
      console.log('Created new conversation:', conversation.id);
    } else {
      // Update existing conversation - reopen if resolved, increment unread
      await supabase
        .from('conversations')
        .update({
          status: 'open', // Reopen if was resolved
          unread_count: conversation.unread_count + 1,
          last_message_at: new Date().toISOString(),
          marked_unread: false,
        })
        .eq('id', conversation.id);
      console.log('Using existing conversation:', conversation.id);
    }

    // Determine message type and content
    let messageType: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text';
    let content = text?.message || null;
    let mediaUrl = null;

    if (image) {
      messageType = 'image';
      mediaUrl = image.imageUrl || image.url;
      content = image.caption || null;
    } else if (video) {
      messageType = 'video';
      mediaUrl = video.videoUrl || video.url;
      content = video.caption || null;
    } else if (audio) {
      messageType = 'audio';
      mediaUrl = audio.audioUrl || audio.url;
    } else if (document) {
      messageType = 'document';
      mediaUrl = document.documentUrl || document.url;
      content = document.fileName || null;
    }

    // For group messages, prepend participant name to content
    let displayContent = content;
    if (isGroupChat && (participantName || senderName)) {
      const participant = participantName || senderName;
      displayContent = content ? `[${participant}]: ${content}` : `[${participant}]`;
    }

    // Save message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'contact',
        message_type: messageType,
        content: displayContent,
        media_url: mediaUrl,
        whatsapp_message_id: messageId,
        sent_at: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
      })
      .select()
      .single();

    if (msgError) {
      console.error('Error creating message:', msgError);
      throw msgError;
    }

    console.log('Message saved:', message.id);

    // Trigger AI auto-reply (non-blocking, internal call with service key)
    try {
      const aiUrl = `${supabaseUrl}/functions/v1/ai-maybe-reply`;
      fetch(aiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'X-Internal-Secret': supabaseServiceKey,
        },
        body: JSON.stringify({ conversation_id: conversation.id }),
      }).then(res => res.json()).then(aiResult => {
        console.log('AI maybe-reply result:', aiResult);
      }).catch(aiErr => {
        console.error('AI maybe-reply error:', aiErr);
      });
    } catch (aiError) {
      console.error('Failed to trigger AI:', aiError);
      // Don't fail the webhook if AI fails
    }

    return new Response(JSON.stringify({ 
      success: true, 
      contact_id: contactRecord.id,
      conversation_id: conversation.id,
      message_id: message.id,
      is_group: isGroupChat,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
