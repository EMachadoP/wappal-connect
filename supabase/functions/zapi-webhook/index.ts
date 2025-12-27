import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    console.log('[Z-API Webhook] Payload received:', JSON.stringify(payload));

    // Ignorar status de entrega/leitura para focar apenas em mensagens recebidas por enquanto
    if (payload.status || payload.ack) {
      return new Response(JSON.stringify({ success: true, ignored: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const fromMe = Boolean(payload.fromMe);
    const isGroup = Boolean(payload.isGroup);
    
    // Normalização de IDs
    // Tenta pegar o ID de várias formas possíveis que o Z-API pode enviar
    const rawChatId = payload.chatLid || payload.chatId || payload.phone;
    
    if (!rawChatId) {
      console.error('[Z-API Webhook] Error: No Chat ID found in payload');
      return new Response(JSON.stringify({ error: 'No Chat ID found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const chatLid = rawChatId.trim().toLowerCase();
    
    // Extrair telefone limpo (apenas números)
    let phone = payload.phone;
    if (phone && typeof phone === 'string') {
      phone = phone.replace('@c.us', '').replace('@g.us', '');
    }
    // Se for grupo, não usamos o telefone como identificador principal de contato
    const cleanPhone = isGroup ? null : phone;
    
    const lid = payload.lid || payload.contact?.lid;

    console.log(`[Z-API Webhook] Processing: chatLid=${chatLid}, phone=${cleanPhone}, isGroup=${isGroup}`);

    // 1. Localizar ou Criar Contato
    let contactId;
    
    // Tenta encontrar contato existente
    let query = supabase.from('contacts').select('id');
    
    if (chatLid) {
      query = query.or(`chat_lid.eq."${chatLid}",phone.eq."${cleanPhone || 'null'}",lid.eq."${lid || 'null'}"`);
    } else {
      // Fallback improvável
      query = query.eq('phone', cleanPhone);
    }

    const { data: existingContact, error: findError } = await query.maybeSingle();

    if (findError) {
      console.error('[Z-API Webhook] Error finding contact:', findError);
    }

    if (existingContact) {
      contactId = existingContact.id;
      // Atualiza info se necessário
      const updates: any = {};
      if (!isGroup && chatLid && chatLid.includes('@')) updates.chat_lid = chatLid;
      if (payload.senderName || payload.chatName) updates.whatsapp_display_name = payload.senderName || payload.chatName;
      
      if (Object.keys(updates).length > 0) {
        await supabase.from('contacts').update(updates).eq('id', contactId);
      }
    } else {
      console.log('[Z-API Webhook] Creating new contact...');
      const { data: newContact, error: cErr } = await supabase
        .from('contacts')
        .insert({
          name: payload.senderName || payload.chatName || cleanPhone || "Contato Novo",
          phone: cleanPhone,
          lid: lid,
          chat_lid: chatLid,
          is_group: isGroup,
          whatsapp_display_name: payload.senderName || payload.chatName,
          profile_picture_url: payload.senderPhoto || payload.chatPhoto || null
        })
        .select('id')
        .single();
        
      if (cErr) {
        console.error('[Z-API Webhook] Error creating contact:', cErr);
        throw cErr;
      }
      contactId = newContact.id;
    }

    // 2. Gerenciar Conversa (usando chat_id como chave de thread)
    // Garantir que a conversa seja encontrada pelo identificador estável (chat_id)
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, unread_count, status')
      .eq('chat_id', chatLid) // Usar chat_id como chave primária de busca é mais seguro
      .maybeSingle();

    let conversationId;
    
    if (conv) {
      conversationId = conv.id;
      console.log(`[Z-API Webhook] Found existing conversation ${conversationId}`);
      
      const updates: any = {
        last_message_at: new Date().toISOString(),
        unread_count: fromMe ? 0 : (conv.unread_count || 0) + 1,
      };
      
      // Se estava resolvida, reabre
      if (conv.status === 'resolved' && !fromMe) {
        updates.status = 'open';
        updates.resolved_at = null;
        updates.resolved_by = null;
      }
      
      await supabase.from('conversations').update(updates).eq('id', conversationId);
    } else {
      console.log('[Z-API Webhook] Creating new conversation...');
      // Fallback para thread_key se não achou por chat_id (para compatibilidade legada)
      const { data: legacyConv } = await supabase
        .from('conversations')
        .select('id')
        .eq('thread_key', chatLid)
        .maybeSingle();
        
      if (legacyConv) {
        conversationId = legacyConv.id;
        await supabase.from('conversations').update({
          chat_id: chatLid, // Atualiza para ter o chat_id
          last_message_at: new Date().toISOString(),
          unread_count: fromMe ? 0 : 1,
          status: fromMe ? 'open' : 'open'
        }).eq('id', conversationId);
      } else {
        const { data: newConv, error: convErr } = await supabase
          .from('conversations')
          .insert({
            contact_id: contactId,
            chat_id: chatLid,
            thread_key: chatLid, // Manter thread_key igual ao chat_id
            status: 'open',
            unread_count: fromMe ? 0 : 1,
            last_message_at: new Date().toISOString()
          })
          .select('id')
          .single();
          
        if (convErr) {
          console.error('[Z-API Webhook] Error creating conversation:', convErr);
          throw convErr;
        }
        conversationId = newConv.id;
      }
    }

    // 3. Extrair Conteúdo
    let content = "";
    if (payload.text && typeof payload.text === 'object' && payload.text.message) content = payload.text.message;
    else if (payload.message && typeof payload.message === 'object' && payload.message.text) content = payload.message.text;
    else if (typeof payload.body === 'string') content = payload.body;
    else if (typeof payload.content === 'string') content = payload.content; // Z-API variações
    else if (payload.caption) content = payload.caption;
    else if (payload.image?.caption) content = payload.image.caption;
    
    // Fallback para tipos de mídia sem legenda
    if (!content && payload.type) {
      if (payload.type === 'image') content = '📷 Imagem';
      else if (payload.type === 'audio' || payload.type === 'ppt') content = '🎤 Áudio';
      else if (payload.type === 'video') content = '🎥 Vídeo';
      else if (payload.type === 'document') content = '📄 Documento';
      else if (payload.type === 'sticker') content = '👾 Figurinha';
      else content = `[Mensagem: ${payload.type}]`;
    }

    // 4. Salvar Mensagem
    const messageData = {
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      sender_name: payload.senderName || null,
      message_type: payload.type === 'image' ? 'image' : (payload.type === 'audio' || payload.type === 'ppt' ? 'audio' : (payload.type === 'video' ? 'video' : (payload.type === 'document' ? 'document' : 'text'))),
      content: content,
      provider: 'zapi',
      provider_message_id: payload.messageId || payload.id,
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl || payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url || null,
    };

    console.log('[Z-API Webhook] Saving message:', JSON.stringify(messageData));

    const { error: msgErr } = await supabase.from('messages').insert(messageData);
    
    if (msgErr) {
      console.error('[Z-API Webhook] Error saving message:', msgErr);
      throw msgErr;
    }

    // 5. Acionar IA se necessário (apenas se for entrada de contato e não for grupo)
    // Usar call assíncrona (não await) para responder rápido ao webhook
    if (!fromMe && !isGroup) {
      console.log('[Z-API Webhook] Triggering AI check...');
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(err => console.error('[Webhook AI Trigger Error]', err));
    }
    
    // Acionar notificação de grupo se necessário
    if (!fromMe && !isGroup) {
       fetch(`${supabaseUrl}/functions/v1/notify-open-tickets-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(err => console.error('[Webhook Notify Trigger Error]', err));
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[Z-API Webhook] Critical Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});