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

    // SEGURANÇA: Validar Client-Token da Z-API se configurado
    const expectedToken = Deno.env.get('ZAPI_WEBHOOK_TOKEN');
    const receivedToken = req.headers.get('Client-Token');

    if (expectedToken && receivedToken !== expectedToken) {
      console.error('[Z-API Webhook] Falha de autenticação: Token inválido');
      return new Response(JSON.stringify({ error: 'Unauthorized Webhook' }), { status: 401 });
    }

    const payload = await req.json();
    console.log('[Z-API Webhook] Recebido:', payload.messageId);

    const fromMe = Boolean(payload.fromMe);
    const isGroup = Boolean(payload.isGroup);
    
    const chatLid = payload.chatLid || payload.phone;
    const lid = payload.contact?.lid || (payload.phone?.includes('@lid') ? payload.phone : null);
    const phone = payload.phone?.includes('@c.us') ? payload.phone.replace('@c.us', '') : (isGroup ? null : payload.phone);
    
    if (!chatLid) return new Response(JSON.stringify({ error: 'No ID' }), { status: 400 });

    // Localizar Contato
    let contactId;
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .or(`chat_lid.eq.${chatLid}${phone ? `,phone.eq.${phone}` : ''}${lid ? `,lid.eq.${lid}` : ''}`)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      // Manter identificadores atualizados
      await supabase.from('contacts').update({ 
        chat_lid: chatLid,
        lid: lid || undefined
      }).eq('id', contactId);
    } else {
      const { data: newContact, error: cErr } = await supabase
        .from('contacts')
        .insert({
          name: payload.senderName || payload.chatName || phone || "Contato",
          phone: isGroup ? null : phone,
          lid: lid,
          chat_lid: chatLid,
          is_group: isGroup,
        })
        .select('id')
        .single();
      if (cErr) throw cErr;
      contactId = newContact.id;
    }

    // Gerenciar Conversa (thread_key = chatLid)
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

    // Salvar Mensagem
    let content = payload.text?.message || payload.message?.text || payload.body || payload.image?.caption || "";
    if (!content && payload.type) content = `[${payload.type}]`;

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      message_type: payload.type === 'image' ? 'image' : (payload.type === 'audio' ? 'audio' : 'text'),
      content: content,
      provider: 'zapi',
      provider_message_id: payload.messageId,
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.image?.url || payload.audio?.url || null,
    });

    // IA (apenas se não for do próprio bot e não for grupo)
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});