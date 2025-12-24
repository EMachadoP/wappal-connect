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
    const isGroup = Boolean(payload.isGroup);
    
    // Extração de identificadores conforme as recomendações de LID
    const lid = payload.contact?.lid || (payload.phone?.includes('@lid') ? payload.phone : null);
    const phone = payload.phone?.includes('@c.us') || /^\d+$/.test(payload.phone) ? payload.phone : null;
    const chatLid = payload.chatLid || payload.phone; // chatLid é a chave da conversa
    
    if (!chatLid) return new Response(JSON.stringify({ error: 'No identifier found' }), { status: 400 });

    // 1. Localizar ou criar Contato
    // Prioridade de busca: LID > Phone
    let contactQuery = supabase.from('contacts').select('id');
    if (lid) {
      contactQuery = contactQuery.or(`lid.eq."${lid}",chat_lid.eq."${chatLid}"`);
    } else {
      contactQuery = contactQuery.eq('chat_lid', chatLid);
    }
    
    const { data: contact } = await contactQuery.maybeSingle();
    let contactId = contact?.id;

    if (!contactId) {
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          name: payload.senderName || payload.chatName || "Contato",
          phone: isGroup ? null : (phone ? phone.replace('@c.us', '') : null),
          lid: lid,
          chat_lid: chatLid,
          is_group: isGroup,
        })
        .select('id')
        .single();
      
      if (contactError) throw contactError;
      contactId = newContact.id;
    } else {
      // Atualiza o contato com o LID se ele ainda não tiver
      if (lid) {
        await supabase.from('contacts').update({ lid }).eq('id', contactId).is('lid', null);
      }
    }

    // 2. Localizar ou criar Conversa (Usando chatLid como thread_key única)
    const threadKey = chatLid;
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
          chat_id: chatLid, // Garante que o chat_id esteja atualizado com o LID/chatLid
        })
        .eq('id', conversationId);
    } else {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactId,
          chat_id: chatLid,
          thread_key: threadKey,
          status: 'open',
          unread_count: fromMe ? 0 : 1,
        })
        .select('id')
        .single();
      
      if (convError) throw convError;
      conversationId = newConv.id;
    }

    // 3. Extração de conteúdo
    let content = "";
    if (typeof payload.text === 'string') content = payload.text;
    else if (payload.text?.message) content = payload.text.message;
    else if (payload.message?.text) content = payload.message.text;
    else if (payload.body) content = payload.body;
    else if (payload.image?.caption) content = payload.image.caption;
    if (!content && payload.type) content = `[${payload.type}]`;

    // 4. Salvar Mensagem
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      message_type: payload.type === 'image' ? 'image' : (payload.type === 'audio' ? 'audio' : 'text'),
      content: content,
      provider: 'zapi',
      provider_message_id: messageId,
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.image?.url || payload.audio?.url || null,
    });

    // 5. IA - Resposta automática (apenas para mensagens recebidas e não grupos)
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(err => console.error('Erro disparando IA:', err));
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});