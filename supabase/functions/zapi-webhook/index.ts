import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const payload = await req.json();
    
    console.log('[Z-API Webhook] Payload:', JSON.stringify(payload, null, 2));

    const messageId = payload.messageId;
    const fromMe = Boolean(payload.fromMe);
    const phone = payload.phone;
    const chatLid = payload.chatLid;
    const isGroup = Boolean(payload.isGroup);
    
    // Identificador único da conversa
    const rawChatId = chatLid || phone;
    if (!rawChatId) return new Response(JSON.stringify({ error: 'No phone/chatLid' }), { status: 400 });
    
    const chatId = rawChatId.trim().toLowerCase();

    // Extração robusta de conteúdo
    let content = "";
    if (typeof payload.text === 'string') content = payload.text;
    else if (payload.text?.message) content = payload.text.message;
    else if (payload.message?.text) content = payload.message.text;
    else if (payload.body) content = payload.body;
    else if (payload.image?.caption) content = payload.image.caption;
    else if (payload.video?.caption) content = payload.video.caption;

    // Se for mensagem de sistema ou vazia (ex: vcard), usamos o tipo como fallback
    if (!content && payload.type) content = `[${payload.type}]`;

    // 1. Localizar ou criar Contato
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .or(`chat_lid.eq.${chatId},phone.eq.${chatId.replace(/\D/g, '')}`)
      .maybeSingle();

    let contactId = contact?.id;

    if (!contactId) {
      const { data: newContact } = await supabase
        .from('contacts')
        .insert({
          name: payload.senderName || payload.chatName || chatId,
          phone: isGroup ? null : chatId.replace(/\D/g, ''),
          chat_lid: chatId,
          is_group: isGroup,
        })
        .select('id')
        .single();
      contactId = newContact?.id;
    }

    // 2. Localizar ou criar Conversa (baseado no thread_key)
    const threadKey = chatId;
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, unread_count, ai_mode')
      .eq('thread_key', threadKey)
      .maybeSingle();

    let conversationId = conv?.id;

    if (!conversationId) {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactId,
          chat_id: chatId,
          thread_key: threadKey,
          status: 'open',
        })
        .select('id')
        .single();
      conversationId = newConv?.id;
    } else {
      // Atualizar metadados da conversa
      await supabase
        .from('conversations')
        .update({
          status: 'open',
          last_message_at: new Date().toISOString(),
          unread_count: fromMe ? 0 : (conv.unread_count || 0) + 1,
        })
        .eq('id', conversationId);
    }

    // 3. Salvar Mensagem
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      message_type: payload.type === 'text' ? 'text' : (payload.image ? 'image' : (payload.audio ? 'audio' : 'text')),
      content: content,
      provider: 'zapi',
      provider_message_id: messageId,
      chat_id: chatId,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
    });

    // 4. Disparar IA se for mensagem recebida e não for grupo
    if (!fromMe && !isGroup && conversationId) {
      console.log('[Webhook] Chamando ai-maybe-reply para:', conversationId);
      // Chamada assíncrona
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(err => console.error('Erro ao disparar IA:', err));
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Webhook Error]', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});