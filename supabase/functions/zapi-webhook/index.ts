import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const payload = await req.json();
    console.log('[Z-API Webhook] Payload recebido:', JSON.stringify(payload));

    // 1. Validar idempotência (evitar duplicados)
    const providerMessageId = payload.messageId;
    if (providerMessageId) {
      const { data: existing } = await supabase
        .from('messages')
        .select('id')
        .eq('provider_message_id', providerMessageId)
        .maybeSingle();
      
      if (existing) {
        return new Response(JSON.stringify({ success: true, duplicated: true }));
      }
    }

    // 2. Extrair dados básicos
    const phone = payload.phone;
    const senderName = payload.senderName || payload.pushName || phone;
    const isGroup = !!payload.isGroup;
    const chatId = payload.chatId || phone;
    const content = payload.text?.message || payload.caption || "";
    
    // 3. Identificar ou Criar Contato
    let { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (!contact) {
      const { data: newContact, error: contactErr } = await supabase
        .from('contacts')
        .insert({
          phone,
          name: senderName,
          is_group: isGroup,
          chat_lid: isGroup ? chatId : null,
          whatsapp_display_name: payload.pushName
        })
        .select('id')
        .single();
      
      if (contactErr) throw contactErr;
      contact = newContact;
    }

    // 4. Identificar ou Criar Conversa (Thread)
    const threadKey = isGroup ? chatId : phone;
    let { data: conversation } = await supabase
      .from('conversations')
      .select('id, unread_count')
      .eq('thread_key', threadKey)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          contact_id: contact.id,
          chat_id: chatId,
          thread_key: threadKey,
          status: 'open',
          unread_count: 1
        })
        .select('id, unread_count')
        .single();
      
      if (convErr) throw convErr;
      conversation = newConv;
    } else {
      // Atualizar contagem de não lidas e data da última mensagem
      await supabase
        .from('conversations')
        .update({ 
          unread_count: (conversation.unread_count || 0) + 1,
          last_message_at: new Date().toISOString(),
          status: 'open' // Reabre se estiver resolvida
        })
        .eq('id', conversation.id);
    }

    // 5. Inserir a Mensagem
    const { error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'contact',
        sender_name: senderName,
        content: content,
        message_type: 'text',
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString()
      });

    if (msgErr) throw msgErr;

    // 6. Trigger opcional para IA (se configurado)
    // fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-maybe-reply`, { ... });

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error('[Z-API Webhook Error]', error.message);
    return new Response(error.message, { status: 500 });
  }
});