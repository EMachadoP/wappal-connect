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
    console.log('[Z-API Webhook] Payload:', JSON.stringify(payload));

    const fromMe = Boolean(payload.fromMe);
    const isGroup = Boolean(payload.isGroup);
    
    // Normalização de IDs
    const rawChatId = payload.chatLid || payload.chatId || payload.phone;
    if (!rawChatId) throw new Error('No Chat ID found');
    
    const chatLid = rawChatId.trim().toLowerCase();
    const phone = payload.phone?.includes('@c.us') ? payload.phone.replace('@c.us', '') : (isGroup ? null : payload.phone);
    const lid = payload.contact?.lid || (payload.phone?.includes('@lid') ? payload.phone : null);

    // 1. Localizar ou Criar Contato
    let contactId;
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .or(`chat_lid.eq."${chatLid}",phone.eq."${phone || 'null'}",lid.eq."${lid || 'null'}"`)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      await supabase.from('contacts').update({ 
        chat_lid: chatLid,
        whatsapp_display_name: payload.senderName || payload.chatName || undefined
      }).eq('id', contactId);
    } else {
      const { data: newContact, error: cErr } = await supabase
        .from('contacts')
        .insert({
          name: payload.senderName || payload.chatName || phone || "Contato Novo",
          phone: isGroup ? null : phone,
          lid: lid,
          chat_lid: chatLid,
          is_group: isGroup,
          whatsapp_display_name: payload.senderName || payload.chatName
        })
        .select('id')
        .single();
      if (cErr) throw cErr;
      contactId = newContact.id;
    }

    // 2. Gerenciar Conversa (usando thread_key normalizada)
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, unread_count')
      .eq('thread_key', chatLid)
      .maybeSingle();

    let conversationId;
    if (conv) {
      conversationId = conv.id;
      await supabase.from('conversations').update({
        status: 'open',
        last_message_at: new Date().toISOString(),
        unread_count: fromMe ? 0 : (conv.unread_count || 0) + 1,
        chat_id: chatLid
      }).eq('id', conversationId);
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactId,
          chat_id: chatLid,
          thread_key: chatLid,
          status: 'open',
          unread_count: fromMe ? 0 : 1,
        })
        .select('id')
        .single();
      if (convErr) throw convErr;
      conversationId = newConv.id;
    }

    // 3. Extrair Conteúdo
    let content = "";
    if (payload.text?.message) content = payload.text.message;
    else if (payload.message?.text) content = payload.message.text;
    else if (typeof payload.body === 'string') content = payload.body;
    else if (payload.image?.caption) content = payload.image.caption;
    
    if (!content && payload.type) content = `[Mensagem de tipo: ${payload.type}]`;

    // 4. Salvar Mensagem
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      sender_name: payload.senderName || null,
      message_type: payload.type === 'image' ? 'image' : (payload.type === 'audio' ? 'audio' : 'text'),
      content: content,
      provider: 'zapi',
      provider_message_id: payload.messageId,
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url || null,
    });

    // 5. IA se for entrada
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(err => console.error('[Webhook AI Error]', err));
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});