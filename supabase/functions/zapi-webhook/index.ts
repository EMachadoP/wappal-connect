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
    
    console.log('[Webhook] Payload recebido:', payload.messageId);

    const fromMe = Boolean(payload.fromMe);
    const isGroup = Boolean(payload.isGroup);
    
    // Identificadores estáveis
    const chatLid = payload.chatLid || payload.phone;
    const lid = payload.contact?.lid || (payload.phone?.includes('@lid') ? payload.phone : null);
    const phone = payload.phone?.includes('@c.us') ? payload.phone.replace('@c.us', '') : (isGroup ? null : payload.phone);
    
    if (!chatLid) {
      return new Response(JSON.stringify({ error: 'No ID' }), { status: 400 });
    }

    // 1. Localizar ou criar Contato (Busca multi-critério)
    let contactId;
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .or(`chat_lid.eq."${chatLid}",lid.eq."${lid || 'null'}",phone.eq."${phone || 'null'}"`)
      .maybeSingle();

    if (contact) {
      contactId = contact.id;
      // Atualizar metadados se necessário
      await supabase.from('contacts').update({ 
        chat_lid: chatLid,
        lid: lid || undefined,
        phone: isGroup ? null : (phone || undefined)
      }).eq('id', contactId);
    } else {
      const { data: newContact, error: cErr } = await supabase
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
      if (cErr) throw cErr;
      contactId = newContact.id;
    }

    // 2. Localizar ou criar Conversa (Usando chatLid como thread_key)
    const threadKey = chatLid;
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, unread_count')
      .eq('thread_key', threadKey)
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
          thread_key: threadKey,
          status: 'open',
          unread_count: fromMe ? 0 : 1,
        })
        .select('id')
        .single();
      if (convErr) throw convErr;
      conversationId = newConv.id;
    }

    // 3. Processar Conteúdo
    let content = "";
    if (typeof payload.text === 'string') content = payload.text;
    else if (payload.text?.message) content = payload.text.message;
    else if (payload.message?.text) content = payload.message.text;
    else if (payload.body) content = payload.body;
    else if (payload.image?.caption) content = payload.image.caption;
    if (!content && payload.type) content = `[${payload.type}]`;

    // 4. Salvar Mensagem (Ponto Crítico)
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
      media_url: payload.image?.url || payload.audio?.url || null,
    });

    if (msgErr) console.error('[Webhook] Erro ao salvar msg:', msgErr);

    // 5. IA (Disparo assíncrono para não travar o webhook)
    if (!fromMe && !isGroup) {
      // Usamos edge computing para disparar a IA sem esperar a resposta
      edgeRetryAI(supabaseUrl, supabaseServiceKey, conversationId);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Webhook Fatal Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

// Função auxiliar para disparar a IA sem bloquear o Webhook
function edgeRetryAI(url: string, key: string, conversationId: string) {
  fetch(`${url}/functions/v1/ai-maybe-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ conversation_id: conversationId }),
  }).catch(err => console.error('[IA Trigger Error]', err));
}