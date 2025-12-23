import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zapi-token',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Normalize chat_id: trim, lowercase
function normalizeChatId(chatId: string | null | undefined): string | null {
  if (!chatId) return null;
  return chatId.trim().toLowerCase();
}

// Check if this is a group chat (ends with @g.us)
function isGroupChatId(chatId: string | null | undefined): boolean {
  if (!chatId) return false;
  return chatId.toLowerCase().includes('@g.us');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate webhook authentication
    const zapiToken = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');
    
    const requestZapiToken = req.headers.get('x-zapi-token') || req.headers.get('X-ZAPI-Token');
    const requestClientToken = req.headers.get('client-token') || req.headers.get('Client-Token');
    
    const isValidZapiToken = zapiToken && requestZapiToken && requestZapiToken === zapiToken;
    const isValidClientToken = clientToken && requestClientToken && requestClientToken === clientToken;
    
    if ((zapiToken || clientToken) && !isValidZapiToken && !isValidClientToken) {
      if (!requestZapiToken && !requestClientToken) {
        console.log('Warning: No authentication token received from Z-API.');
      } else {
        console.log('Invalid webhook token - rejecting request');
        return new Response(
          JSON.stringify({ error: 'Unauthorized webhook request' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const payload = await req.json();
    
    console.log('Z-API Webhook received:', JSON.stringify(payload, null, 2));

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

    // IDEMPOTENCY CHECK: Skip if we already processed this message
    if (messageId) {
      const { data: existingMessage } = await supabase
        .from('messages')
        .select('id')
        .eq('provider', 'zapi')
        .eq('provider_message_id', messageId)
        .maybeSingle();

      if (existingMessage) {
        console.log('Message already exists, skipping:', messageId);
        return new Response(JSON.stringify({ 
          success: true, 
          duplicate: true,
          message_id: existingMessage.id,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const isFromMe = Boolean(fromMe);
    const direction = isFromMe ? 'outbound' : 'inbound';
    
    // Normalize chat_id for consistent lookup
    const rawChatId = chatLid || null;
    const chatId = normalizeChatId(rawChatId);
    const isGroupChat = isGroupChatId(chatId) || Boolean(isGroup);
    
    // For group messages: extract sender (participant) info separately
    let senderPhone: string | null = null;
    let senderDisplayName: string | null = null;
    
    if (isGroupChat) {
      // participantPhone/participantLid is the actual sender in a group
      senderPhone = participantPhone?.replace(/\D/g, '') || null;
      senderDisplayName = participantName || senderName || null;
    }
    
    console.log('Processing message:', { 
      fromMe: isFromMe, 
      type, 
      messageId, 
      chatId, 
      direction, 
      isGroup: isGroupChat,
      senderPhone,
      senderDisplayName 
    });

    // Extract contact/group info
    let contactLid: string | null = null;
    let contactPhone: string | null = null;
    let contactName: string;
    let contactPhoto: string | null = null;
    let groupName: string | null = null;

    if (isGroupChat) {
      // For groups: use the group chat_id as the identifier, NOT participant phone
      const isLidGroup = chatId?.includes('@lid') || false;
      contactLid = isLidGroup ? chatId : null;
      contactPhone = null; // Groups don't have a phone
      contactName = chatName || 'Grupo';
      groupName = chatName || contactName;
      contactPhoto = null;
    } else {
      const isLid = phone?.includes('@lid');
      contactLid = isLid ? phone : contact?.lid || null;
      contactPhone = isLid ? null : phone?.replace(/\D/g, '') || null;
      contactName = senderName || contact?.name || contactPhone || contactLid || 'Contato Desconhecido';
      contactPhoto = senderPhoto || contact?.profilePicture || null;
    }

    // Find or create contact
    let contactRecord;
    
    if (contactLid) {
      const { data: existingByLid } = await supabase
        .from('contacts')
        .select('*')
        .eq('lid', contactLid)
        .single();
      contactRecord = existingByLid;
    }
    
    if (!contactRecord && contactPhone) {
      const { data: existingByPhone } = await supabase
        .from('contacts')
        .select('*')
        .eq('phone', contactPhone)
        .maybeSingle();
      contactRecord = existingByPhone;
    }

    if (!contactRecord && chatLid) {
      const { data: existingByChatLid } = await supabase
        .from('contacts')
        .select('*')
        .eq('chat_lid', chatLid)
        .maybeSingle();
      contactRecord = existingByChatLid;
    }

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
      console.log('Created new contact:', contactRecord.id);
    } else {
      // Update contact with latest info
      const updates: Record<string, unknown> = {};
      
      if (contactLid && !contactRecord.lid) {
        updates.lid = contactLid;
        updates.lid_source = 'zapi_webhook';
        updates.lid_collected_at = new Date().toISOString();
      }
      if (contactPhone && !contactRecord.phone) updates.phone = contactPhone;
      if (chatLid && !contactRecord.chat_lid) updates.chat_lid = chatLid;
      if (contactName && contactRecord.name === 'Contato Desconhecido') updates.name = contactName;
      if (contactPhoto && !contactRecord.profile_picture_url) updates.profile_picture_url = contactPhoto;
      if (isGroupChat && !contactRecord.is_group) {
        updates.is_group = true;
        updates.group_name = groupName;
      }
      if (senderName && senderName !== contactRecord.whatsapp_display_name) {
        updates.whatsapp_display_name = senderName;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from('contacts').update(updates).eq('id', contactRecord.id);
        console.log('Updated contact with:', updates);
      }
    }

    // FIND CONVERSATION BY CHAT_ID FIRST (idempotent), then by contact_id
    let conversation;
    
    if (chatId) {
      const { data: convByChatId } = await supabase
        .from('conversations')
        .select('*')
        .eq('chat_id', chatId)
        .maybeSingle();
      
      if (convByChatId) {
        conversation = convByChatId;
        console.log('Found conversation by chat_id:', conversation.id);
      }
    }

    if (!conversation) {
      const { data: convByContact } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contactRecord.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      
      conversation = convByContact;
      
      if (conversation) {
        // Update chat_id if missing
        if (chatId && !conversation.chat_id) {
          await supabase
            .from('conversations')
            .update({ chat_id: chatId })
            .eq('id', conversation.id);
          console.log('Updated conversation with chat_id:', chatId);
        }
      }
    }

    if (!conversation) {
      const { data: newConversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactRecord.id,
          chat_id: chatId,
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
      console.log('Created new conversation:', conversation.id, 'with chat_id:', chatId);
    } else {
      // Update conversation
      const updateData: Record<string, unknown> = {
        last_message_at: new Date().toISOString(),
      };
      
      if (!isFromMe) {
        updateData.status = 'open';
        updateData.unread_count = conversation.unread_count + 1;
        updateData.marked_unread = false;
      }
      
      await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversation.id);
    }

    // Determine message type and content
    let messageType: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text';
    let content: string | null = null;
    let mediaUrl = null;

    if (typeof text === 'string') {
      content = text;
    } else if (text?.message) {
      content = text.message;
    } else if (payload.message) {
      content = typeof payload.message === 'string' ? payload.message : payload.message?.text || null;
    } else if (payload.body) {
      content = payload.body;
    }

    if (image) {
      messageType = 'image';
      mediaUrl = image.imageUrl || image.url;
      content = image.caption || content || null;
    } else if (video) {
      messageType = 'video';
      mediaUrl = video.videoUrl || video.url;
      content = video.caption || content || null;
    } else if (audio) {
      messageType = 'audio';
      mediaUrl = audio.audioUrl || audio.url;
    } else if (document) {
      messageType = 'document';
      mediaUrl = document.documentUrl || document.url;
      content = document.fileName || content || null;
    }

    // For group messages, prepend participant name
    let displayContent = content;
    if (isGroupChat && (participantName || senderName)) {
      const participant = participantName || senderName;
      displayContent = content ? `[${participant}]: ${content}` : `[${participant}]`;
    }

    // INSERT MESSAGE WITH IDEMPOTENCY (unique constraint on provider + provider_message_id)
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: isFromMe ? 'agent' : 'contact',
        message_type: messageType,
        content: displayContent,
        media_url: mediaUrl,
        provider: 'zapi',
        provider_message_id: messageId || null,
        chat_id: chatId,
        direction: direction,
        status: 'delivered',
        raw_payload: payload,
        whatsapp_message_id: messageId,
        sent_at: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
        // Group participant info
        sender_phone: senderPhone,
        sender_name: senderDisplayName,
      })
      .select()
      .single();

    if (msgError) {
      // Check if it's a duplicate constraint violation
      if (msgError.code === '23505') {
        console.log('Duplicate message detected via constraint:', messageId);
        return new Response(JSON.stringify({ 
          success: true, 
          duplicate: true,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('Error creating message:', msgError);
      throw msgError;
    }

    console.log('Message saved:', message.id, { direction, status: 'delivered' });

    // Trigger AI auto-reply only for inbound messages
    if (!isFromMe) {
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
      }
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
