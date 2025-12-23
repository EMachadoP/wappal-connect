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
  return chatId.toLowerCase().endsWith('@g.us');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // IDEMPOTENCY CHECK
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
    
    // Normalize chat_id - this is the KEY for conversation lookup
    const rawChatId = chatLid || phone || null;
    const chatId = normalizeChatId(rawChatId);

    // Detect group: chatId ends with @g.us OR payload indicates group
    const isGroupChat = isGroupChatId(chatId) || Boolean(isGroup);

    // In some Z-API payloads, `phone` may not include "@g.us"; prefer a stable group identifier.
    // We only accept `phone` as group id when it clearly looks like a group key (has '-' or '@g.us').
    const groupChatIdRaw = isGroupChat
      ? (chatLid ||
          (typeof phone === 'string' && (phone.includes('-') || phone.toLowerCase().includes('@g.us'))
            ? phone
            : null) ||
          payload?.reaction?.referencedMessage?.phone ||
          null)
      : null;
    const groupChatId = normalizeChatId(groupChatIdRaw);

    const conversationKey = isGroupChat ? groupChatId : chatId;

    if (isGroupChat && !conversationKey) {
      console.log('GROUP message without stable group id (chatLid/phone). Skipping.', {
        chatLid,
        phone,
        messageId,
        chatName,
      });

      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Processing message:', { 
      fromMe: isFromMe, 
      type, 
      messageId, 
      chatId, 
      direction, 
      isGroup: isGroupChat,
      participantPhone,
      participantName 
    });

    // For GROUP messages: sender info goes ONLY in the message, not in contact/conversation lookup
    let msgSenderPhone: string | null = null;
    let msgSenderName: string | null = null;
    
    if (isGroupChat) {
      msgSenderPhone = participantPhone?.replace(/\D/g, '') || null;
      msgSenderName = participantName || senderName || null;
    }

    let contactRecord;
    let conversation;

    // ========== GROUP HANDLING ==========
    if (isGroupChat) {
      const groupKey = conversationKey!;

      // For groups: find/create contact by chat_lid (the group itself)
      const { data: existingGroupContact } = await supabase
        .from('contacts')
        .select('*')
        .eq('chat_lid', groupKey)
        .eq('is_group', true)
        .maybeSingle();

      if (existingGroupContact) {
        contactRecord = existingGroupContact;
        // Update group name if changed
        if (chatName && chatName !== contactRecord.group_name) {
          await supabase
            .from('contacts')
            .update({
              group_name: chatName,
              name: chatName,
            })
            .eq('id', contactRecord.id);
        }
      } else {
        // Create new group contact
        const groupName = chatName || 'Grupo';
        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            chat_lid: groupKey,
            name: groupName,
            is_group: true,
            group_name: groupName,
            lid_source: 'zapi_webhook',
            lid_collected_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (contactError) {
          console.error('Error creating group contact:', contactError);
          throw contactError;
        }
        contactRecord = newContact;
        console.log('Created new group contact:', contactRecord.id, 'for group_key:', groupKey);
      }

      // For groups: find conversation ONLY by chat_id
      const { data: convByChatId } = await supabase
        .from('conversations')
        .select('*')
        .eq('chat_id', groupKey)
        .maybeSingle();

      if (convByChatId) {
        conversation = convByChatId;
        console.log('Found group conversation by chat_id:', conversation.id);
      } else {
        // Create new conversation for this group
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            contact_id: contactRecord.id,
            chat_id: groupKey,
            status: 'open',
            unread_count: 1,
            last_message_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (convError) {
          // Handle unique constraint violation (race condition)
          if (convError.code === '23505') {
            const { data: existingConv } = await supabase
              .from('conversations')
              .select('*')
              .eq('chat_id', groupKey)
              .single();
            conversation = existingConv;
            console.log('Found existing conversation after race condition:', conversation?.id);
          } else {
            console.error('Error creating group conversation:', convError);
            throw convError;
          }
        } else {
          conversation = newConversation;
          console.log('Created new group conversation:', conversation.id, 'with chat_id:', groupKey);
        }
      }

    // ========== PRIVATE CHAT HANDLING ==========
    } else {
      // For private chats: use phone/lid as identifier
      const isLid = phone?.includes('@lid');
      const contactLid = isLid ? phone : contact?.lid || null;
      const contactPhone = isLid ? null : phone?.replace(/\D/g, '') || null;
      const contactName = senderName || contact?.name || contactPhone || contactLid || 'Contato Desconhecido';
      const contactPhoto = senderPhoto || contact?.profilePicture || null;

      // Find existing contact
      if (contactLid) {
        const { data: existingByLid } = await supabase
          .from('contacts')
          .select('*')
          .eq('lid', contactLid)
          .maybeSingle();
        contactRecord = existingByLid;
      }

      if (!contactRecord && contactPhone) {
        const { data: existingByPhone } = await supabase
          .from('contacts')
          .select('*')
          .eq('phone', contactPhone)
          .eq('is_group', false)
          .maybeSingle();
        contactRecord = existingByPhone;
      }

      if (!contactRecord && chatId) {
        const { data: existingByChatLid } = await supabase
          .from('contacts')
          .select('*')
          .eq('chat_lid', chatId)
          .eq('is_group', false)
          .maybeSingle();
        contactRecord = existingByChatLid;
      }

      if (!contactRecord) {
        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            lid: contactLid,
            phone: contactPhone,
            chat_lid: chatId,
            name: contactName,
            profile_picture_url: contactPhoto,
            lid_source: 'zapi_webhook',
            lid_collected_at: new Date().toISOString(),
            is_group: false,
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
        if (chatId && !contactRecord.chat_lid) updates.chat_lid = chatId;
        if (contactName && contactRecord.name === 'Contato Desconhecido') updates.name = contactName;
        if (contactPhoto && !contactRecord.profile_picture_url) updates.profile_picture_url = contactPhoto;
        if (senderName && senderName !== contactRecord.whatsapp_display_name) {
          updates.whatsapp_display_name = senderName;
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from('contacts').update(updates).eq('id', contactRecord.id);
          console.log('Updated contact with:', updates);
        }
      }

      // Find/create conversation for private chat
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

        if (conversation && chatId && !conversation.chat_id) {
          await supabase
            .from('conversations')
            .update({ chat_id: chatId })
            .eq('id', conversation.id);
          console.log('Updated conversation with chat_id:', chatId);
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
          if (convError.code === '23505' && chatId) {
            const { data: existingConv } = await supabase
              .from('conversations')
              .select('*')
              .eq('chat_id', chatId)
              .single();
            conversation = existingConv;
          } else {
            console.error('Error creating conversation:', convError);
            throw convError;
          }
        } else {
          conversation = newConversation;
          console.log('Created new conversation:', conversation.id);
        }
      }
    }

    // Update conversation for new message
    if (conversation) {
      const updateData: Record<string, unknown> = {
        last_message_at: new Date().toISOString(),
      };

      if (!isFromMe) {
        updateData.status = 'open';
        updateData.unread_count = (conversation.unread_count || 0) + 1;
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

    // For group messages, prepend participant name in content
    let displayContent = content;
    if (isGroupChat && msgSenderName) {
      displayContent = content ? `[${msgSenderName}]: ${content}` : `[${msgSenderName}]`;
    }

    // INSERT MESSAGE
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
        sender_phone: msgSenderPhone,
        sender_name: msgSenderName,
      })
      .select()
      .single();

    if (msgError) {
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

    console.log('Message saved:', message.id, { direction, isGroup: isGroupChat });

    // Trigger AI auto-reply for inbound messages
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
