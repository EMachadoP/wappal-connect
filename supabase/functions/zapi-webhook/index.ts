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
    console.log('[Z-API Webhook] Payload recebido:', JSON.stringify(payload));

    const fromMe = Boolean(payload.fromMe);
    const isGroup = Boolean(payload.isGroup);
    
    // Z-API envia IDs em diferentes campos dependendo da versão/tipo
    const chatLid = payload.chatLid || payload.chatId || payload.phone;
    const lid = payload.contact?.lid || (payload.phone?.includes('@lid') ? payload.phone : null);
    const phone = payload.phone?.includes('@c.us') ? payload.phone.replace('@c.us', '') : (isGroup ? null : payload.phone);
    
    if (!chatLid) {
      console.error('[Z-API Webhook] Falha: Nenhum identificador de chat encontrado no payload');
      return new Response(JSON.stringify({ error: 'No Chat ID found' }), { status: 400 });
    }

    // 1. Localizar ou Criar Contato
    let contactId;
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .or(`chat_lid.eq.${chatLid}${phone ? `,phone.eq.${phone}` : ''}${lid ? `,lid.eq.${lid}` : ''}`)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      await supabase.from('contacts').update({ 
        chat_lid: chatLid,
        lid: lid || undefined,
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

    // 2. Gerenciar Conversa (thread_key = chatLid para consistência)
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
        chat_id: chatLid // Atualiza o chat_id real
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

    // 3. Extrair Conteúdo da Mensagem
    let content = "";
    if (payload.text?.message) content = payload.text.message;
    else if (payload.message?.text) content = payload.message.text;
    else if (typeof payload.body === 'string') content = payload.body;
    else if (payload.image?.caption) content = payload.image.caption;
    
    if (!content && payload.type) content = `[Mensagem de tipo: ${payload.type}]`;

    // 4. Salvar Mensagem no Banco
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      message_type: payload.type === 'image' ? 'image' : (payload.type === 'audio' ? 'audio' : 'text'),
      content: content,
      provider: 'zapi',
      provider_message_id: payload.messageId,
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url || null,
    });

    if (msgErr) console.error('[Z-API Webhook] Erro ao inserir mensagem:', msgErr);

    // 5. Acionar IA se for entrada e não for grupo
    if (!fromMe && !isGroup) {
      console.log('[Z-API Webhook] Acionando resposta automática de IA...');
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${supabaseServiceKey}` 
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(err => console.error('[Z-API Webhook] Erro ao chamar ai-maybe-reply:', err));
    }

    return new Response(JSON.stringify({ success: true, conversationId }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[Z-API Webhook Critical Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});