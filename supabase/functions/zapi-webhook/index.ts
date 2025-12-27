import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 1. Permitir chamadas de teste (CORS)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  console.log(`[Z-API WEBHOOK] Request received: ${req.method}`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Registrar que o webhook foi chamado no banco para debug visual
    await supabase.from('zapi_settings').update({ 
      last_webhook_received_at: new Date().toISOString() 
    }).is('team_id', null);

    const payload = await req.json();
    console.log('[Z-API WEBHOOK] Payload Full:', JSON.stringify(payload));

    // Ignorar ACKs e Status (evitar loops)
    if (payload.status || payload.ack) {
      console.log('[Z-API WEBHOOK] Ignored (Status/Ack)');
      return new Response(JSON.stringify({ success: true, ignored: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!payload.phone) {
      console.error('[Z-API WEBHOOK] Error: No phone in payload');
      return new Response(JSON.stringify({ error: 'No phone provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isGroup = Boolean(payload.isGroup);
    const fromMe = Boolean(payload.fromMe);
    const chatLid = (payload.chatLid || payload.chatId || payload.phone).trim().toLowerCase();
    const rawPhone = payload.phone.split('@')[0];
    const cleanPhone = isGroup ? null : rawPhone;

    console.log(`[Z-API WEBHOOK] Identifying: Chat=${chatLid}, FromMe=${fromMe}, Group=${isGroup}`);

    // 2. Localizar ou Criar Contato (usando UPSERT para evitar erros de duplicidade)
    const contactData = {
      chat_lid: chatLid,
      phone: cleanPhone,
      is_group: isGroup,
      name: payload.senderName || payload.chatName || rawPhone || "Contato Novo",
      whatsapp_display_name: payload.senderName || payload.chatName,
      profile_picture_url: payload.senderPhoto || payload.chatPhoto || null,
      updated_at: new Date().toISOString()
    };

    // Tenta encontrar por chat_lid ou phone
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .or(`chat_lid.eq."${chatLid}",phone.eq."${cleanPhone || 'null'}"`)
      .limit(1)
      .maybeSingle();

    let contactId;
    if (existingContact) {
      contactId = existingContact.id;
      await supabase.from('contacts').update(contactData).eq('id', contactId);
    } else {
      const { data: newContact, error: cErr } = await supabase
        .from('contacts')
        .insert(contactData)
        .select('id')
        .single();
      if (cErr) throw cErr;
      contactId = newContact.id;
    }

    // 3. Localizar ou Criar Conversa
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, unread_count, status')
      .eq('chat_id', chatLid)
      .maybeSingle();

    let conversationId;
    if (conv) {
      conversationId = conv.id;
      const updates: any = {
        last_message_at: new Date().toISOString(),
        unread_count: fromMe ? 0 : (conv.unread_count || 0) + 1,
        status: (conv.status === 'resolved' && !fromMe) ? 'open' : conv.status
      };
      await supabase.from('conversations').update(updates).eq('id', conversationId);
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactId,
          chat_id: chatLid,
          thread_key: chatLid,
          status: 'open',
          unread_count: fromMe ? 0 : 1,
          last_message_at: new Date().toISOString()
        })
        .select('id')
        .single();
      if (convErr) throw convErr;
      conversationId = newConv.id;
    }

    // 4. Extrair Texto
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";
    if (!content && payload.type) {
      const icons: any = { image: '📷 Imagem', audio: '🎤 Áudio', ptt: '🎤 Áudio', video: '🎥 Vídeo', document: '📄 Documento' };
      content = icons[payload.type] || `[${payload.type}]`;
    }

    // 5. Salvar Mensagem
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      sender_name: payload.senderName || null,
      message_type: (payload.type === 'ptt' ? 'audio' : (payload.type || 'text')),
      content: content,
      provider: 'zapi',
      provider_message_id: payload.messageId || payload.id,
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl || payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url || null,
    });

    if (msgErr) console.error('[Z-API WEBHOOK] DB Error:', msgErr);

    // 6. Resposta IA (async)
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(e => console.error('[Z-API WEBHOOK] AI Trigger Fail:', e));
    }

    console.log('[Z-API WEBHOOK] Success!');
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[Z-API WEBHOOK] FATAL ERROR:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});