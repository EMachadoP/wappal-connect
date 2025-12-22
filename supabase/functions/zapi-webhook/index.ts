import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const payload = await req.json();
    
    console.log('Z-API Webhook received:', JSON.stringify(payload, null, 2));

    // Z-API message structure
    const {
      phone,
      chatLid,
      isGroup,
      messageId,
      fromMe,
      mompiped,
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
    } = payload;

    // Skip group messages
    if (isGroup) {
      console.log('Skipping group message');
      return new Response(JSON.stringify({ success: true, skipped: 'group_message' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Skip messages sent by us
    if (fromMe) {
      console.log('Skipping own message');
      return new Response(JSON.stringify({ success: true, skipped: 'from_me' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract LID from phone field (can be number or LID format like "g1ff3a2d@lid")
    const isLid = phone?.includes('@lid');
    const lid = isLid ? phone : contact?.lid || null;
    const phoneNumber = isLid ? null : phone?.replace(/\D/g, '') || null;

    console.log('Processing message:', { lid, phoneNumber, chatLid, type });

    // Find or create contact
    let contactRecord;
    
    // First try to find by LID
    if (lid) {
      const { data: existingByLid } = await supabase
        .from('contacts')
        .select('*')
        .eq('lid', lid)
        .single();
      
      contactRecord = existingByLid;
    }
    
    // If not found, try by phone
    if (!contactRecord && phoneNumber) {
      const { data: existingByPhone } = await supabase
        .from('contacts')
        .select('*')
        .eq('phone', phoneNumber)
        .single();
      
      contactRecord = existingByPhone;
    }

    // Create new contact if not found
    if (!contactRecord) {
      const contactName = senderName || contact?.name || phoneNumber || lid || 'Contato Desconhecido';
      
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          lid: lid,
          phone: phoneNumber,
          chat_lid: chatLid || null,
          name: contactName,
          profile_picture_url: senderPhoto || contact?.profilePicture || null,
          lid_source: 'zapi_webhook',
          lid_collected_at: new Date().toISOString(),
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
      
      if (lid && !contactRecord.lid) {
        updates.lid = lid;
        updates.lid_source = 'zapi_webhook';
        updates.lid_collected_at = new Date().toISOString();
      }
      if (phoneNumber && !contactRecord.phone) {
        updates.phone = phoneNumber;
      }
      if (chatLid && !contactRecord.chat_lid) {
        updates.chat_lid = chatLid;
      }
      if (senderName && contactRecord.name === 'Contato Desconhecido') {
        updates.name = senderName;
      }
      if ((senderPhoto || contact?.profilePicture) && !contactRecord.profile_picture_url) {
        updates.profile_picture_url = senderPhoto || contact?.profilePicture;
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('contacts')
          .update(updates)
          .eq('id', contactRecord.id);
        console.log('Updated contact with:', updates);
      }
    }

    // Find or create conversation - ONE conversation per contact (like WhatsApp)
    // First try to find ANY existing conversation for this contact
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

    // Save message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'contact',
        message_type: messageType,
        content: content,
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

    return new Response(JSON.stringify({ 
      success: true, 
      contact_id: contactRecord.id,
      conversation_id: conversation.id,
      message_id: message.id,
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
