import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zapi-token',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Input validation constants
const MAX_TEXT_LENGTH = 4096;
const MAX_PHONE_LENGTH = 30;
const MAX_NAME_LENGTH = 100;
const MAX_CHAT_LID_LENGTH = 100;

// Sanitize string: trim, enforce max length, remove control characters
function sanitizeString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  // Remove control characters except newlines and tabs
  const cleaned = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned.trim().slice(0, maxLength) || null;
}

// Validate phone number format (digits only, optional + prefix)
function sanitizePhone(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  // Remove all non-digit characters except leading +
  const cleaned = value.replace(/[^\d+]/g, '').slice(0, MAX_PHONE_LENGTH);
  if (cleaned.length < 5) return null; // Too short to be valid
  return cleaned;
}

// Normalize chat_id: trim, lowercase
function normalizeChatId(chatId: string | null | undefined): string | null {
  if (!chatId) return null;
  return chatId.trim().toLowerCase().slice(0, MAX_CHAT_LID_LENGTH);
}

// Check if this is a group chat (ends with @g.us)
function isGroupChatId(chatId: string | null | undefined): boolean {
  if (!chatId) return false;
  return chatId.toLowerCase().endsWith('@g.us');
}

// Get file extension from content-type
function getExtensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'video/quicktime': 'mov',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[contentType] || 'bin';
}

// Retry with exponential backoff for AI calls
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      // Check if function was found and executed successfully
      if (data.code === 'NOT_FOUND' || data.code === 'BOOT_ERROR') {
        console.log(`AI function not ready (attempt ${attempt + 1}/${maxRetries}):`, data.message);
        
        if (attempt < maxRetries - 1) {
          const delay = baseDelayMs * Math.pow(2, attempt); // 1s, 2s, 4s
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return { success: false, error: data.message };
      }
      
      // Success or other response
      return { success: true, data };
    } catch (err) {
      console.error(`Fetch error (attempt ${attempt + 1}/${maxRetries}):`, err);
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
  return { success: false, error: 'Max retries exceeded' };
}

// Download media and upload to Supabase Storage
// deno-lint-ignore no-explicit-any
async function downloadAndStoreMedia(
  supabase: any,
  sourceUrl: string,
  messageType: string,
  messageId: string
): Promise<{ storageUrl: string | null; sourceUrl: string }> {
  try {
    console.log('Downloading media from:', sourceUrl);
    
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      console.error('Failed to download media:', response.status, response.statusText);
      return { storageUrl: null, sourceUrl };
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const extension = getExtensionFromContentType(contentType);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Generate unique file path: type/YYYY-MM/messageId.ext
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const filePath = `${messageType}/${yearMonth}/${messageId}.${extension}`;

    console.log('Uploading to storage:', filePath, 'size:', uint8Array.length);

    const { data, error } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, uint8Array, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error('Storage upload error:', error);
      return { storageUrl: null, sourceUrl };
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('whatsapp-media')
      .getPublicUrl(filePath);

    console.log('Media stored successfully:', publicUrlData.publicUrl);
    return { storageUrl: publicUrlData.publicUrl, sourceUrl };
  } catch (err) {
    console.error('Error downloading/storing media:', err);
    return { storageUrl: null, sourceUrl };
  }
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

    // Extract and sanitize webhook payload fields
    const phone = sanitizePhone(payload.phone);
    const chatLid = sanitizeString(payload.chatLid, MAX_CHAT_LID_LENGTH);
    const isGroup = Boolean(payload.isGroup);
    const messageId = sanitizeString(payload.messageId, 100);
    const fromMe = Boolean(payload.fromMe);
    const type = sanitizeString(payload.type, 50);
    const text = payload.text;
    const image = payload.image;
    const video = payload.video;
    const audio = payload.audio;
    const document = payload.document;
    const contact = payload.contact;
    const senderName = sanitizeString(payload.senderName, MAX_NAME_LENGTH);
    const senderPhoto = payload.senderPhoto;
    const timestamp = typeof payload.timestamp === 'number' ? payload.timestamp : null;
    const participantPhone = sanitizePhone(payload.participantPhone);
    const participantLid = sanitizeString(payload.participantLid, MAX_CHAT_LID_LENGTH);
    const participantName = sanitizeString(payload.participantName, MAX_NAME_LENGTH);
    const chatName = sanitizeString(payload.chatName, MAX_NAME_LENGTH);

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

    // FILTER OUT CALL NOTIFICATIONS - these are not actual messages
    const notification = sanitizeString(payload.notification, 100);
    const CALL_NOTIFICATIONS = [
      'CALL_VOICE', 'CALL_MISSED_VOICE', 'CALL_VIDEO', 'CALL_MISSED_VIDEO',
      'CALL_MISSED_GROUP_VOICE', 'CALL_MISSED_GROUP_VIDEO'
    ];
    
    if (notification && CALL_NOTIFICATIONS.includes(notification)) {
      console.log('Ignoring call notification:', notification, 'for', chatName || phone);
      return new Response(JSON.stringify({ 
        success: true, 
        skipped: true,
        reason: 'call_notification',
        notification_type: notification,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
      conversationKey,
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

      // For groups: use thread_key = groupKey
      const threadKey = groupKey;
      
      // FIRST: Try to find existing OPEN conversation by thread_key
      const { data: existingOpenConv } = await supabase
        .from('conversations')
        .select('*')
        .eq('thread_key', threadKey)
        .eq('status', 'open')
        .maybeSingle();

      if (existingOpenConv) {
        conversation = existingOpenConv;
        console.log('Found existing OPEN group conversation:', conversation.id, 'for thread_key:', threadKey);
        
        // Update chat_id and contact_id if needed
        if (!conversation.chat_id || conversation.chat_id !== groupKey) {
          await supabase
            .from('conversations')
            .update({ chat_id: groupKey, contact_id: contactRecord.id })
            .eq('id', conversation.id);
        }
      } else {
        // Check if there's a resolved conversation we can reopen
        const { data: existingResolvedConv } = await supabase
          .from('conversations')
          .select('*')
          .eq('thread_key', threadKey)
          .eq('status', 'resolved')
          .order('resolved_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingResolvedConv) {
          // Reopen the existing conversation
          const { data: reopenedConv } = await supabase
            .from('conversations')
            .update({ 
              status: 'open', 
              resolved_at: null, 
              resolved_by: null,
              chat_id: groupKey,
              contact_id: contactRecord.id,
            })
            .eq('id', existingResolvedConv.id)
            .select()
            .single();
          conversation = reopenedConv || existingResolvedConv;
          console.log('Reopened resolved group conversation:', conversation.id);
        } else {
          // Create new conversation
          const { data: newConv, error: convError } = await supabase
            .from('conversations')
            .insert({
              thread_key: threadKey,
              contact_id: contactRecord.id,
              chat_id: groupKey,
              status: 'open',
            })
            .select()
            .single();

          if (convError) {
            console.error('Error creating group conversation:', convError);
            // Race condition - another request might have created it
            const { data: raceConv } = await supabase
              .from('conversations')
              .select('*')
              .eq('thread_key', threadKey)
              .eq('status', 'open')
              .maybeSingle();
            conversation = raceConv;
          } else {
            conversation = newConv;
            console.log('Created new group conversation:', conversation.id, 'with thread_key:', threadKey);
          }
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
        
        // Update name if current name is just the phone number or unknown
        const currentNameIsPhone = contactRecord.name && /^\d+$/.test(contactRecord.name.replace(/\D/g, ''));
        const currentNameIsUnknown = contactRecord.name === 'Contato Desconhecido';
        if (senderName && (currentNameIsPhone || currentNameIsUnknown)) {
          updates.name = senderName;
          console.log('Updating contact name from pushName:', senderName);
        }
        
        if (contactPhoto && !contactRecord.profile_picture_url) updates.profile_picture_url = contactPhoto;
        if (senderName && senderName !== contactRecord.whatsapp_display_name) {
          updates.whatsapp_display_name = senderName;
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from('contacts').update(updates).eq('id', contactRecord.id);
          console.log('Updated contact with:', updates);
        }
      }

      // Calculate thread_key for private chat
      // Priority: phone > lid > chat_lid
      const threadKeyPhone = contactRecord.phone;
      const threadKeyLid = contactRecord.lid;
      const threadKeyChatLid = contactRecord.chat_lid;
      const threadKey = threadKeyPhone || threadKeyLid || threadKeyChatLid || contactRecord.id;
      
      // FIRST: Try to find existing OPEN conversation by thread_key OR chat_id
      const { data: existingOpenConv } = await supabase
        .from('conversations')
        .select('*')
        .or(`thread_key.eq.${threadKey},chat_id.eq.${chatId}`)
        .eq('status', 'open')
        .limit(1)
        .maybeSingle();

      if (existingOpenConv) {
        conversation = existingOpenConv;
        console.log('Found existing OPEN private conversation:', conversation.id, 'for thread_key:', threadKey, 'or chat_id:', chatId);
        
        // Update chat_id, contact_id and thread_key if needed
        const convUpdates: Record<string, any> = {};
        if (!conversation.chat_id || conversation.chat_id !== chatId) {
          convUpdates.chat_id = chatId;
        }
        if (conversation.contact_id !== contactRecord.id) {
          convUpdates.contact_id = contactRecord.id;
        }
        if (conversation.thread_key !== threadKey) {
          convUpdates.thread_key = threadKey;
        }
        if (Object.keys(convUpdates).length > 0) {
          await supabase
            .from('conversations')
            .update(convUpdates)
            .eq('id', conversation.id);
          console.log('Updated conversation with:', convUpdates);
        }
      } else {
        // Check if there's a resolved conversation we can reopen (by thread_key OR chat_id)
        const { data: existingResolvedConv } = await supabase
          .from('conversations')
          .select('*')
          .or(`thread_key.eq.${threadKey},chat_id.eq.${chatId}`)
          .eq('status', 'resolved')
          .order('resolved_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingResolvedConv) {
          // Reopen the existing conversation
          const { data: reopenedConv } = await supabase
            .from('conversations')
            .update({ 
              status: 'open', 
              resolved_at: null, 
              resolved_by: null,
              chat_id: chatId,
              contact_id: contactRecord.id,
              thread_key: threadKey,
            })
            .eq('id', existingResolvedConv.id)
            .select()
            .single();
          conversation = reopenedConv || existingResolvedConv;
          console.log('Reopened resolved private conversation:', conversation.id);
        } else {
          // Create new conversation
          const { data: newConv, error: convError } = await supabase
            .from('conversations')
            .insert({
              thread_key: threadKey,
              contact_id: contactRecord.id,
              chat_id: chatId,
              status: 'open',
            })
            .select()
            .single();

          if (convError) {
            console.error('Error creating private conversation:', convError);
            // Race condition - another request might have created it, search by both thread_key and chat_id
            const { data: raceConv } = await supabase
              .from('conversations')
              .select('*')
              .or(`thread_key.eq.${threadKey},chat_id.eq.${chatId}`)
              .eq('status', 'open')
              .limit(1)
              .maybeSingle();
            conversation = raceConv;
            if (conversation) {
              console.log('Found conversation after race condition:', conversation.id);
            }
          } else {
            conversation = newConv;
            console.log('Created new private conversation:', conversation.id, 'with thread_key:', threadKey);
          }
        }
      }
    }

    // Update conversation for new message
    if (conversation) {
      const updateData: Record<string, unknown> = {
        last_message_at: new Date().toISOString(),
      };

      if (!isFromMe) {
        // Reopen conversation and reset resolved state on new inbound message
        updateData.status = 'open';
        updateData.unread_count = (conversation.unread_count || 0) + 1;
        updateData.marked_unread = false;
        updateData.resolved_at = null;
        updateData.resolved_by = null;
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

    // Track source URL for metadata
    let sourceMediaUrl: string | null = null;

    if (image) {
      messageType = 'image';
      sourceMediaUrl = image.imageUrl || image.url;
      content = image.caption || content || null;
    } else if (video) {
      messageType = 'video';
      sourceMediaUrl = video.videoUrl || video.url;
      content = video.caption || content || null;
    } else if (audio) {
      messageType = 'audio';
      sourceMediaUrl = audio.audioUrl || audio.url;
    } else if (document) {
      messageType = 'document';
      sourceMediaUrl = document.documentUrl || document.url;
      content = document.fileName || content || null;
    }

    // Download and store media in Supabase Storage
    if (sourceMediaUrl && messageId) {
      const { storageUrl, sourceUrl } = await downloadAndStoreMedia(
        supabase,
        sourceMediaUrl,
        messageType,
        messageId
      );
      if (storageUrl) {
        mediaUrl = storageUrl;
        // Store original URL in raw_payload (already done)
        console.log('Media stored, using storage URL:', storageUrl);
      } else {
        // Fallback to original URL if storage fails
        mediaUrl = sourceUrl;
        console.log('Storage failed, using source URL:', sourceUrl);
      }
    } else if (sourceMediaUrl) {
      // No messageId, use source URL directly
      mediaUrl = sourceMediaUrl;
    }

    // Ensure content is never null/empty - use placeholder based on message type
    if (!content || content.trim() === '') {
      switch (messageType) {
        case 'image':
          content = '📷 Imagem';
          break;
        case 'video':
          content = '🎬 Vídeo';
          break;
        case 'audio':
          content = '🎤 Áudio';
          break;
        case 'document':
          content = '📄 Documento';
          break;
        default:
          content = '📎 Mídia';
      }
    }

    // For group messages, prepend participant name in content
    let displayContent = content;
    if (isGroupChat && msgSenderName) {
      displayContent = `[${msgSenderName}]: ${content}`;
    }

    // INSERT MESSAGE - use conversationKey for groups to ensure consistency
    const messageChatId = isGroupChat ? conversationKey : chatId;

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
        chat_id: messageChatId,
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

    // Check for protocol resolution in group messages
    if (isGroupChat && !isFromMe && content) {
      const resolutionPatterns = [
        // G7-20251223-0005 - Resolvido (with various dash types and spaces)
        /(G7-\d{8}-\d{4,})\s*[-–—]?\s*resolvido/i,
        // Protocolo G7-20251223-0005 Resolvido
        /protocolo[:\s]*(G7-\d{8}-\d{4,}).*resolvido/i,
        // 202512-0007 - Resolvido (YYYYMM-NNNN format with spaces and dashes)
        /(\d{6}-\d{4,})\s*[-–—]?\s*resolvido/i,
        // Protocolo 202512-0007 Resolvido
        /protocolo[:\s]*(\d{6}-\d{4,}).*resolvido/i,
      ];
      
      const isResolutionMessage = resolutionPatterns.some(pattern => pattern.test(content));
      
      if (isResolutionMessage) {
        console.log('Detected resolution message, triggering handler');
        try {
          const resolutionUrl = `${supabaseUrl}/functions/v1/group-resolution-handler`;
          fetch(resolutionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message_content: content,
              participant_phone: msgSenderPhone,
              participant_name: msgSenderName,
              group_id: conversationKey,
              message_id: messageId,
            }),
          }).then(res => res.json()).then(resolutionResult => {
            console.log('Resolution handler result:', resolutionResult);
          }).catch(resErr => {
            console.error('Resolution handler error:', resErr);
          });
        } catch (resError) {
          console.error('Failed to trigger resolution handler:', resError);
        }
      }
    }

    // Trigger AI auto-reply for inbound messages (non-group only)
    // Using EdgeRuntime.waitUntil for background processing with retry
    if (!isFromMe && !isGroupChat) {
      const aiUrl = `${supabaseUrl}/functions/v1/ai-maybe-reply`;
      const conversationId = conversation.id;
      
      // Background task with retry logic
      const aiTask = async () => {
        console.log('Starting AI maybe-reply task for conversation:', conversationId);
        
        const result = await fetchWithRetry(
          aiUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'X-Internal-Secret': supabaseServiceKey,
            },
            body: JSON.stringify({ conversation_id: conversationId }),
          },
          3, // max retries
          2000 // base delay 2s (will be 2s, 4s, 8s)
        );
        
        if (result.success) {
          console.log('AI maybe-reply result:', result.data);
        } else {
          console.error('AI maybe-reply failed after retries:', result.error);
        }
      };
      
      // Use EdgeRuntime.waitUntil if available, otherwise fire-and-forget
      // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(aiTask());
      } else {
        // Fallback for environments without EdgeRuntime
        aiTask().catch(err => console.error('AI task error:', err));
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
