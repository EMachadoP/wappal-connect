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
    
    // Log detalhado para depuração no painel do Supabase
    console.log('[Z-API Webhook] Novo evento:', payload.messageId, 'Tipo:', payload.type);

    const fromMe = Boolean(payload.fromMe);
    const isGroup = Boolean(payload.isGroup);
    
    // Identificadores (Prioridade total para o LID)
    const chatLid = payload.chatLid || payload.phone;
    const lid = payload.contact?.lid || (payload.phone?.includes('@lid') ? payload.phone : null);
    const phone = payload.phone?.includes('@c.us') ? payload.phone.replace('@c.us', '') : (isGroup ? null : payload.phone);
    
    if (!chatLid) {
      console.error('[Webhook] Erro: Nenhum chatLid ou phone encontrado no payload');
      return new Response(JSON.stringify({ error: 'No identifier' }), { status: 400 });
    }

    // 1. Localizar ou criar Contato
    // Buscamos por LID ou por chatLid (que é o ID estável do Z-API)
    let { data: contact } = await supabase
      .from('contacts')
      .select('id, name')
      .or(`chat_lid.eq.${chatLid}${lid ? `,lid.eq.${lid}` : ''}${phone ? `,phone.eq.${phone}` : ''}`)
      .maybeSingle();

    let contactId;
    if (contact) {
      contactId = contact.id;
      // Atualizar LID se o contato foi criado antes dessa tecnologia existir no sistema
      if (lid || chatLid) {
        await supabase.from('contacts').update({ 
          lid: lid || null, 
          chat_lid: chatLid 
        }).eq('id', contactId);
      }
    } else {
      console.log('[Webhook] Criando novo contato para:', chatLid);
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          name: payload.senderName || payload.chatName || phone || "Contato WhatsApp",
          phone: isGroup ? null : phone,
          lid: lid,
          chat_lid: chatLid,
          is_group: isGroup,
        })
        .select('id')
        .single();
      
      if (contactError) throw contactError;
      contactId = newContact.id;
    }

    // 2. Localizar ou criar Conversa (thread_key = chatLid)
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
          chat_id: chatLid,
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

    // 3. Extração de conteúdo (Suporte a múltiplos formatos do Z-API)
    let content = "";
    if (typeof payload.text === 'string') content = payload.text;
    else if (payload.text?.message) content = payload.text.message;
    else if (payload.message?.text) content = payload.message.text;
    else if (payload.body) content = payload.body;
    else if (payload.image?.caption) content = payload.image.caption;
    if (!content && payload.type) content = `[${payload.type}]`;

    // 4. Salvar Mensagem
    const { error: msgError } = await supabase.from('messages').insert({
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

    if (msgError) console.error('[Webhook] Erro ao salvar mensagem:', msgError);

    // 5. IA - Resposta automática
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(err => console.error('[Webhook] Erro disparando IA:', err));
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});