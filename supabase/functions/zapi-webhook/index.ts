import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const now = new Date().toISOString();
  console.log(`[Z-API WEBHOOK] Request received at ${now}`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Registrar atividade (Sinal de Vida)
    // Tenta atualizar, se não houver linha, não faz nada (evita erro)
    await supabase.from('zapi_settings')
      .update({ last_webhook_received_at: now })
      .is('team_id', null);

    const payload = await req.json();
    
    // Ignorar confirmações de leitura
    if (payload.status || payload.ack) {
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    const phone = payload.phone || payload.senderPhone || payload.chatId;
    if (!phone) throw new Error('Payload sem identificador');

    const isGroup = Boolean(payload.isGroup);
    const fromMe = Boolean(payload.fromMe);
    const chatLid = (payload.chatLid || payload.chatId || phone).trim().toLowerCase();
    const contactName = payload.senderName || payload.chatName || payload.pushName || phone.split('@')[0];

    // 2. Salvar Contato
    const { data: contact } = await supabase.from('contacts').upsert({
      chat_lid: chatLid,
      phone: isGroup ? null : phone.split('@')[0],
      name: contactName,
      is_group: isGroup,
      updated_at: now
    }, { onConflict: 'chat_lid' }).select('id').single();

    if (!contact) throw new Error('Falha ao processar contato');

    // 3. Salvar Conversa
    const { data: conv } = await supabase.from('conversations').upsert({
      contact_id: contact.id,
      chat_id: chatLid,
      thread_key: chatLid,
      status: 'open',
      last_message_at: now
    }, { onConflict: 'chat_id' }).select('id').single();

    if (!conv) throw new Error('Falha ao processar conversa');

    if (!fromMe) await supabase.rpc('increment_unread_count', { conv_id: conv.id });

    // 4. Salvar Mensagem
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";
    if (!content && payload.type) content = `[${payload.type}]`;

    await supabase.from('messages').insert({
      conversation_id: conv.id,
      sender_type: fromMe ? 'agent' : 'contact',
      sender_name: payload.senderName || contactName,
      message_type: (payload.type === 'ptt' ? 'audio' : (payload.type || 'text')),
      content: content || "Mensagem de mídia",
      provider: 'zapi',
      provider_message_id: payload.messageId || payload.id || crypto.randomUUID(),
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: now,
      media_url: payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl || payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url || null,
    });

    // 5. IA (opcional)
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ conversation_id: conv.id }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('[Webook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: corsHeaders });
  }
});