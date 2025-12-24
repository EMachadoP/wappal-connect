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
    
    console.log('[Z-API Webhook] Payload recebido');

    const messageId = payload.messageId;
    const fromMe = Boolean(payload.fromMe);
    const isGroup = Boolean(payload.isGroup);
    
    // Normalização do ID: removemos @c.us mas mantemos @g.us para grupos
    const rawId = (payload.chatLid || payload.phone || "").trim().toLowerCase();
    if (!rawId) return new Response(JSON.stringify({ error: 'No identifier found' }), { status: 400 });
    
    const chatId = isGroup ? rawId : rawId.replace('@c.us', '');
    const phoneOnly = chatId.replace(/\D/g, '');

    // Extração de conteúdo
    let content = "";
    if (typeof payload.text === 'string') content = payload.text;
    else if (payload.text?.message) content = payload.text.message;
    else if (payload.message?.text) content = payload.message.text;
    else if (payload.body) content = payload.body;
    else if (payload.image?.caption) content = payload.image.caption;
    else if (payload.video?.caption) content = payload.video.caption;
    if (!content && payload.type) content = `[${payload.type}]`;

    // 1. Localizar ou criar Contato
    let contactId;
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .or(`chat_lid.eq."${chatId}",phone.eq."${phoneOnly}"`)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          name: payload.senderName || payload.chatName || chatId,
          phone: isGroup ? null : phoneOnly,
          chat_lid: chatId,
          is_group: isGroup,
        })
        .select('id')
        .single();
      
      if (contactError) throw contactError;
      contactId = newContact.id;
    }

    // 2. Localizar ou criar Conversa (Usando o chatId normalizado como thread_key)
    const threadKey = chatId;
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, unread_count')
      .eq('thread_key', threadKey)
      .maybeSingle();

    let conversationId;
    if (conv) {
      conversationId = conv.id;
      await supabase
        .from('conversations')
        .update({
          status: 'open',
          last_message_at: new Date().toISOString(),
          unread_count: fromMe ? 0 : (conv.unread_count || 0) + 1,
        })
        .eq('id', conversationId);
    } else {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactId,
          chat_id: chatId,
          thread_key: threadKey,
          status: 'open',
          unread_count: fromMe ? 0 : 1,
        })
        .select('id')
        .single();
      
      if (convError) throw convError;
      conversationId = newConv.id;
    }

    // 3. Salvar Mensagem
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      message_type: payload.type === 'image' ? 'image' : (payload.type === 'audio' ? 'audio' : 'text'),
      content: content,
      provider: 'zapi',
      provider_message_id: messageId,
      chat_id: chatId,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.image?.url || payload.audio?.url || payload.video?.url || null,
    });

    // 4. IA - Resposta automática
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(err => console.error('Erro assíncrono IA:', err));
    }

    return new Response(JSON.stringify({ success: true, conversationId }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});