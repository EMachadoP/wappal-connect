import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const now = new Date().toISOString();
  let payload: any;

  try {
    payload = await req.json();
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Security Token for private Z-API URLs
    const { data: zapiSettings } = await supabase.from('zapi_settings').select('zapi_security_token').maybeSingle();
    const zapiClientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') || zapiSettings?.zapi_security_token;

    // --- LOG DE DEPURAÇÃO (ai_logs) ---
    // Registramos tudo o que chega para podermos debugar falhas em mensagens reais
    await supabase.from('ai_logs').insert({
      status: 'webhook_received',
      input_excerpt: JSON.stringify(payload).substring(0, 1000),
      model: 'webhook-debug',
      provider: 'zapi',
      created_at: now
    });

    // 1. Obter configurações
    const { data: settings } = await supabase.from('zapi_settings')
      .select('forward_webhook_url')
      .is('team_id', null)
      .maybeSingle();

    // Registrar sinal de vida
    await supabase.from('zapi_settings')
      .update({ last_webhook_received_at: now })
      .is('team_id', null);

    // 2. ENCAMINHAMENTO (Forwarding)
    if (settings?.forward_webhook_url) {
      fetch(settings.forward_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error('[Forward Error]', err));
    }

    // 3. Ignorar apenas se for uma atualização de status pura (sem mensagem)
    // Mensagens recebidas podem vir com status: "RECEIVED", então checamos se não tem conteúdo
    const isStatusUpdate = Boolean(payload.ack || payload.type === 'chatState' || (payload.status && !payload.text && !payload.message && !payload.image && !payload.video && !payload.audio && !payload.document));

    if (isStatusUpdate) {
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // --- IDENTIFICAÇÃO LID-FIRST ---
    const isGroup = Boolean(payload.isGroup || (payload.chatLid && payload.chatLid.includes('@g.us')) || (payload.chatId && payload.chatId.includes('@g.us')));
    const fromMe = Boolean(payload.fromMe);

    // Função para normalizar IDs (preservar @lid e @g.us, remover apenas sufixos legados)
    const normalizeLid = (id: string | null | undefined) => {
      if (!id) return id;
      let normalized = id.trim().toLowerCase();

      // Preserve @lid and @g.us (LID identifiers)
      if (normalized.endsWith('@lid') || normalized.endsWith('@g.us')) {
        return normalized;
      }

      // Remove legacy suffixes only (@c.us, @s.whatsapp.net)
      if (normalized.includes('@')) {
        normalized = normalized.split('@')[0];
      }

      return normalized;
    };

    let chatLid = normalizeLid(payload.chatLid || payload.chatId || payload.chat?.chatId || payload.phone || payload.senderPhone);

    // Em chats privados, o chatLid é o ID do contato. Em grupos, usamos participantLid ou os campos de contato.
    const contactLid = normalizeLid(payload.contact?.lid || payload.lid || payload.participantLid || (isGroup ? null : chatLid) || payload.senderPhone || payload.phone);

    // Se chatLid ainda estiver vazio mas temos contactLid e não é grupo, chatLid = contactLid
    if (!chatLid && contactLid && !isGroup) {
      chatLid = contactLid;
    }

    if (!contactLid || !chatLid) {
      throw new Error(`Identificadores ausentes: contact=${contactLid}, chat=${chatLid}`);
    }

    // Identificamos o contato base (quem o usuário vê no chat)
    // Se for grupo, o "contato" da conversa é o próprio grupo
    const chatIdentifier = isGroup ? chatLid : contactLid;
    const chatName = payload.chatName || payload.contact?.name || payload.senderName || payload.pushName || (chatIdentifier ? chatIdentifier.split('@')[0] : 'Desconhecido');

    // 4. Salvar/Atualizar Contato do Chat (Grupo ou Individual)
    const { data: contact } = await supabase.from('contacts').upsert({
      chat_lid: chatIdentifier,
      lid: chatIdentifier,
      name: chatName,
      is_group: isGroup,
      updated_at: now
    }, { onConflict: 'chat_lid' }).select('id').single();

    if (!contact) throw new Error('Falha ao processar contato do chat');

    // 5. Salvar/Atualizar Conversa
    // IMPROVED LOOKUP: Check by contact_id first to avoid duplicates from ID normalization changes
    let { data: existingConv } = await supabase.from('conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .maybeSingle();

    // Fallback: check by chat_id if contact didn't match (handles edge cases)
    if (!existingConv) {
      const fallback = await supabase.from('conversations')
        .select('id')
        .eq('chat_id', chatLid)
        .maybeSingle();
      existingConv = fallback.data;
    }

    let conv: { id: string };

    if (existingConv) {
      const { data: updated, error: updateErr } = await supabase.from('conversations')
        .update({
          last_message_at: now,
          chat_id: chatLid,      // Update to latest normalized format
          thread_key: chatLid,   // Sync to current standard
          contact_id: contact.id, // Ensure contact link is current
          status: 'open'
        })
        .eq('id', existingConv.id)
        .select('id')
        .single();

      if (updateErr || !updated) throw new Error(`Erro ao atualizar conversa: ${updateErr?.message}`);
      conv = updated;
    } else {
      const { data: created, error: createErr } = await supabase.from('conversations')
        .upsert({
          contact_id: contact.id,
          chat_id: chatLid,
          thread_key: chatLid,
          status: 'open',
          last_message_at: now
        }, { onConflict: 'thread_key' })
        .select('id')
        .single();

      if (createErr || !created) throw new Error(`Erro ao criar conversa: ${createErr?.message}`);
      conv = created;
    }

    if (!fromMe) await supabase.rpc('increment_unread_count', { conv_id: conv.id });

    // 6. Salvar Mensagem
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";

    // Mapeamento de tipo para o enum do banco: "text" | "image" | "video" | "audio" | "document" | "system"
    let msgType: "text" | "image" | "video" | "audio" | "document" | "system" = "text";
    const pType = (payload.type || "").toLowerCase();

    // Detectar tipo por campos de mídia no payload (prioridade)
    if (payload.audio || payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl) msgType = "audio";
    else if (payload.image || payload.imageUrl || payload.image?.url || payload.image?.imageUrl) msgType = "image";
    else if (payload.video || payload.videoUrl || payload.video?.url || payload.video?.videoUrl) msgType = "video";
    else if (payload.document || payload.documentUrl || payload.document?.url || payload.document?.documentUrl) msgType = "document";
    // Fallback: detectar por type string
    else if (pType === "audio" || pType === "ptt" || pType === "voice") msgType = "audio";
    else if (pType === "image") msgType = "image";
    else if (pType === "video") msgType = "video";
    else if (pType === "document") msgType = "document";

    if (!content && msgType !== "text") {
      const fileName = payload.fileName || payload.document?.fileName || payload.image?.fileName || "";
      content = fileName ? `[Arquivo: ${fileName}]` : `[Mídia: ${msgType}]`;
    }
    if (!content) content = "..."; // Fallback final

    let senderName = payload.contact?.name || payload.senderName || payload.pushName;

    // Fallback logic for agent name (fromMe)
    if (fromMe) {
      if (!senderName || /^\d+$/.test(senderName.replace(/\D/g, ''))) {
        senderName = "Operador (Celular)";
      }
    } else {
      // Fallback for contacts
      senderName = senderName || contactLid.split('@')[0];
    }
    const senderPhone = (payload.contact?.phone || payload.phone || contactLid).split('@')[0];
    const providerMsgId = payload.messageId || payload.id || crypto.randomUUID();

    // Verificação de duplicidade para evitar erro de PK
    const { data: existingMsg } = await supabase
      .from('messages')
      .select('id')
      .eq('provider_message_id', providerMsgId)
      .maybeSingle();

    let msgResult = existingMsg;
    let msgError = null;

    if (!existingMsg) {
      console.log('[Webhook] Salvando nova mensagem:', providerMsgId);
      const insertResult = await supabase.from('messages').insert({
        conversation_id: conv.id,
        sender_type: fromMe ? 'agent' : 'contact',
        sender_name: senderName,
        sender_phone: senderPhone,
        message_type: msgType,
        content: content,
        provider: 'zapi',
        provider_message_id: providerMsgId,
        chat_id: chatLid,
        direction: fromMe ? 'outbound' : 'inbound',
        sent_at: now,
        raw_payload: payload,
        media_url: payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl ||
          payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url ||
          payload.image?.imageUrl || payload.audio?.audioUrl || payload.video?.videoUrl || payload.document?.documentUrl ||
          null,
      }).select('id').single();

      msgResult = insertResult.data;
      msgError = insertResult.error;
    } else {
      console.log('[Webhook] Mensagem duplicada ignorada (já existe):', providerMsgId);
    }


    if (msgError) throw new Error(`Falha ao salvar mensagem: ${msgError.message}`);

    // 6.5. Store media files (audio/video) in Supabase Storage for permanent URLs
    if (msgResult && (msgType === 'audio' || msgType === 'video')) {
      const mediaUrl = payload.audioUrl || payload.videoUrl ||
        payload.audio?.url || payload.video?.url ||
        payload.audio?.audioUrl || payload.video?.videoUrl || null;

      if (mediaUrl) {
        console.log(`[Webhook] Storing ${msgType} in Supabase Storage for message:`, msgResult.id);

        // Call store-media function asynchronously (don't wait for it)
        fetch(`${supabaseUrl}/functions/v1/store-media`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            messageId: msgResult.id,
            mediaUrl: mediaUrl,
            mediaType: msgType,
          }),
        }).then(async r => {
          if (r.ok) {
            const result = await r.json();
            console.log(`[Webhook] ${msgType} stored successfully:`, result.publicUrl);
          } else {
            console.error(`[Webhook] Failed to store ${msgType}:`, await r.text());
          }
        }).catch(err => {
          console.error(`[Webhook] Error storing ${msgType}:`, err);
          // Don't fail the webhook if storage fails - original URL is still saved
        });
      }
    }

    // 7. IA (opcional, só para chats privados)
    // CRÍTICO: Só disparar se for uma nova mensagem (não duplicada)
    if (!fromMe && !isGroup && !msgError && msgResult && !existingMsg) {
      if (msgType === 'audio') {
        // Trigger audio transcription (which will trigger AI reply upon completion)
        const audioUrl = payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl || payload.document?.documentUrl || "";

        console.log('[Webhook] Triggering transcription for:', msgResult.id);
        await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({
            message_id: msgResult.id,
            audio_url: audioUrl,
            conversation_id: conv.id
          }),
        }).then(async r => {
          console.log(`[Webhook] Transcription response: ${r.status}`);
          if (!r.ok) {
            const err = await r.text();
            console.error(`[Webhook] Transcription error: ${err}`);
          }
        }).catch(err => console.error('[Webhook] Failed to trigger transcription:', err));
      } else {
        // Standard text/image handling
        console.log('[Webhook] Triggering AI reply for:', conv.id);
        await fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({ conversation_id: conv.id }),
        }).catch(err => console.error('[Webhook] Failed to trigger AI reply:', err));
      }
    }

    // 8. Group Resolution Handler (for group messages)
    // Check if this is a group message and might be a resolution message
    if (!fromMe && isGroup && !msgError && msgResult && !existingMsg && msgType === 'text') {
      console.log('[Webhook] Checking for protocol resolution in group message');
      await fetch(`${supabaseUrl}/functions/v1/group-resolution-handler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({
          message_id: msgResult.id,
          conversation_id: conv.id,
          message_text: content,
          sender_phone: contactLid,
          sender_name: senderName || 'Desconhecido',
        }),
      }).catch(err => console.error('[Webhook] Failed to trigger group resolution handler:', err));
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('[Webhook Error]', error.message);
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await supabase.from('ai_logs').insert({
        status: 'webhook_error',
        error_message: error.message,
        input_excerpt: JSON.stringify(payload || { error: 'Payload parse failed' }).substring(0, 1000),
        model: 'webhook-debug',
        provider: 'zapi',
        created_at: now
      });
    } catch (logErr) {
      console.error('[Critical Log Error]', logErr);
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: corsHeaders });
  }
});
