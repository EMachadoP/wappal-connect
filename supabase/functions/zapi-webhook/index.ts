import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { isEmployeeSender } from "../_shared/employee.ts";
import { parseAndExtract } from "../_shared/parse.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const now = new Date().toISOString();
  let payload: any;

  try {
    payload = await req.json();
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- LOG DE DEPURAÇÃO (ai_logs) ---
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

    await supabase.from('zapi_settings')
      .update({ last_webhook_received_at: now })
      .is('team_id', null);

    // 2. ENCAMINHAMENTO
    if (settings?.forward_webhook_url) {
      fetch(settings.forward_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error('[Forward Error]', err));
    }

    // 3. Ignorar status updates puros
    const isStatusUpdate = Boolean(payload.ack || payload.type === 'chatState' || (payload.status && !payload.text && !payload.message && !payload.image && !payload.video && !payload.audio && !payload.document));
    if (isStatusUpdate) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

    // --- IDENTIFICAÇÃO E NORMALIZAÇÃO ---
    // --- HELPERS E NORMALIZAÇÃO BLINDADA ---
    const stripPrefix = (s: string) => s.replace(/^(u:|g:)/, '');

    const isLikelyGroupId = (raw: string) => {
      const s = raw.trim().toLowerCase();
      return s.endsWith('@g.us') || s.endsWith('-group') || /^\d{10,14}-\d+$/.test(stripPrefix(s));
    };

    const normalizeGroupJid = (id: string) => {
      let s = (id ?? '').trim().toLowerCase();
      if (!s) return s;
      s = stripPrefix(s);
      s = s.replace(/\s+/g, '');
      const base = s.includes('@') ? s.split('@')[0] : s;
      const base2 = base.endsWith('-group') ? base.slice(0, -'-group'.length) : base;
      return `${base2}@g.us`;
    };

    const normalizeUserId = (id: string) => {
      let s = (id ?? '').trim().toLowerCase();
      if (!s) return s;
      s = stripPrefix(s);
      if (s.endsWith('@lid')) return s;
      if (s.includes('@')) s = s.split('@')[0];
      return s.replace(/\D/g, '');
    };

    const normalizeLid = (id: string | null | undefined, isGrp: boolean) => {
      if (!id) return id as any;
      const raw = id.trim().toLowerCase();
      const group = !!isGrp || isLikelyGroupId(raw);
      if (group) return normalizeGroupJid(raw);
      return normalizeUserId(raw);
    };

    const getChatKey = (id: string | null | undefined, isGrp: boolean) => {
      if (!id) return id as any;
      const raw = id.trim().toLowerCase();

      if (raw.startsWith('g:')) {
        const jid = normalizeGroupJid(raw);
        return `g:${jid}`;
      }
      if (raw.startsWith('u:')) {
        let digits = normalizeUserId(raw);
        if (!digits) return null as any;
        if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
        return `u:${digits}`;
      }

      const group = !!isGrp || isLikelyGroupId(raw);
      if (group) {
        const jid = normalizeGroupJid(raw);
        return `g:${jid}`;
      }

      let digits = normalizeUserId(raw);
      if (!digits) return null as any;
      if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
      return `u:${digits}`;
    };

    const fromMe =
      payload.fromMe === true ||
      payload.fromMe === 1 ||
      payload.fromMe === "true" ||
      payload.fromMe === "1" ||
      Boolean(payload.fromMe);
    const rawChatId = payload.chatId || payload.chat?.chatId || payload.phone || payload.chatLid || payload.senderPhone;
    const isGroup = !!payload.isGroup || (typeof rawChatId === 'string' && isLikelyGroupId(rawChatId));
    const chatLid = normalizeLid(rawChatId, isGroup);

    const contactRaw = payload.senderPhone || payload.contact?.phone || payload.contact?.lid || payload.lid || payload.participantLid || rawChatId;
    const contactLid = normalizeLid(contactRaw, false);

    const chatIdentifier = isGroup ? chatLid : contactLid;
    const chatKey = getChatKey(chatIdentifier, !!isGroup);
    const chatName = payload.chatName || payload.contact?.name || payload.senderName || payload.pushName || (chatIdentifier ? chatIdentifier.split('@')[0] : 'Desconhecido');

    const providerMsgId = payload.messageId || payload.id || crypto.randomUUID();

    // IDEMPOTÊNCIA: Ignorar se a mensagem já existe
    const { data: existingMsg } = await supabase
      .from('messages')
      .select('id')
      .eq('provider_message_id', providerMsgId)
      .maybeSingle();

    if (existingMsg) {
      console.log(`[Webhook] Mensagem duplicada ignorada: ${providerMsgId}`);
      return new Response(JSON.stringify({ success: true, duplicated: true }), { headers: corsHeaders });
    }

    console.log(`[Webhook] Normalizing: ID=${chatIdentifier} -> Key=${chatKey} (Group: ${!!isGroup})`);

    // 4. Salvar/Atualizar Contato usando CHAT_KEY
    let contactId: string;
    const { data: existingContact } = await supabase.from('contacts')
      .select('id, chat_lid, phone, name')
      .eq('chat_key', chatKey)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      // Atualizar dados se vierem novos (ex: nome, lid caso ainda não tenha)
      const updates: any = { updated_at: now };
      if (!existingContact.chat_lid && chatIdentifier.includes('@')) updates.chat_lid = chatIdentifier;
      if (!existingContact.phone && !isGroup && !chatIdentifier.includes('@')) updates.phone = chatIdentifier;

      await supabase.from('contacts').update(updates).eq('id', contactId);
    } else {
      const { data: newContact, error: insertError } = await supabase.from('contacts').insert({
        chat_key: chatKey,
        chat_lid: chatIdentifier,
        lid: chatIdentifier,
        name: chatName,
        is_group: isGroup,
        phone: !isGroup && !chatIdentifier.includes('@') ? chatIdentifier : null,
        updated_at: now
      }).select('id').single();

      if (insertError || !newContact) throw new Error(`Falha ao criar contato: ${insertError?.message}`);
      contactId = newContact.id;
    }

    // 5. Message Metadata Resolution (Moved up for Conversation Update)
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";
    let msgType: "text" | "image" | "video" | "audio" | "document" | "system" = "text";
    const pType = (payload.type || "").toLowerCase();

    if (payload.audio || payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl) msgType = "audio";
    else if (pType.includes("image") || payload.image) msgType = "image";
    else if (pType.includes("video") || payload.video) msgType = "video";
    else if (pType.includes("document") || payload.document) msgType = "document";

    const lastMessagePreview =
      (content && content.trim()) ||
      (payload.audio || payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl ? "🎧 Áudio" : "") ||
      (pType.includes("image") || payload.image ? "📷 Foto" : "") ||
      (pType.includes("video") || payload.video ? "🎥 Vídeo" : "") ||
      (pType.includes("document") || payload.document ? "📄 Documento" : "") ||
      (msgType !== 'text' ? `[${msgType}]` : "📩 Mensagem");

    const messagePreview = lastMessagePreview.slice(0, 500);

    // 6. Salvar/Atualizar Conversa
    let { data: existingConv } = await supabase.from('conversations')
      .select('id, active_condominium_id')
      .eq('contact_id', contactId)
      .maybeSingle();

    // Auto-Condominium Selection
    let autoCondoId: string | null = null;
    if (!existingConv?.active_condominium_id) {
      const { data: linkedCondos } = await supabase
        .from('contact_condominiums')
        .select('condominium_id, is_default')
        .eq('contact_id', contactId);

      if (linkedCondos && linkedCondos.length > 0) {
        const defaultCondo = linkedCondos.find((lc: any) => lc.is_default);
        autoCondoId = defaultCondo?.condominium_id || (linkedCondos.length === 1 ? linkedCondos[0].condominium_id : null);
      }
    }

    let conv: { id: string };

    if (existingConv) {
      const updateData: any = {
        last_message_at: now,
        last_message: lastMessagePreview,
        last_message_type: msgType,
        chat_id: chatLid, // Atualizamos o chat_id na conversa para o mais recente (@lid ou normal)
        status: 'open'
      };

      if (!fromMe && autoCondoId) {
        updateData.active_condominium_id = autoCondoId;
        updateData.active_condominium_set_by = 'human';
        updateData.active_condominium_set_at = now;
      }

      const { data: updated, error: updateErr } = await supabase.from('conversations')
        .update(updateData)
        .eq('id', existingConv.id)
        .select('id')
        .single();

      if (updateErr || !updated) throw new Error(`Erro ao atualizar conversa: ${updateErr?.message}`);

      // If fromMe, protect service flags (don't overwrite AI mode or assignment)
      if (fromMe && existingConv) {
        // We already updated basic fields, but we ensure we didn't wipe anything critical
        // actually we just updated what was in updateData.
      }

      conv = updated;
    } else {
      const insertData: any = {
        contact_id: contactId,
        chat_id: chatLid,
        thread_key: chatKey, // Thread key agora baseada na chave canônica
        status: 'open',
        last_message_at: now,
        last_message: lastMessagePreview,
        last_message_type: msgType
      };

      if (!fromMe && autoCondoId) {
        insertData.active_condominium_id = autoCondoId;
        insertData.active_condominium_set_by = 'human';
        insertData.active_condominium_set_at = now;
      }

      const { data: created, error: createErr } = await supabase.from('conversations')
        .upsert(insertData, { onConflict: 'thread_key' })
        .select('id')
        .single();

      if (createErr || !created) throw new Error(`Erro ao criar conversa: ${createErr?.message}`);
      conv = created;
    }

    if (!fromMe) await supabase.rpc('increment_unread_count', { conv_id: conv.id });

    // 7. Salvar Mensagem
    else if (payload.image || payload.imageUrl || payload.image?.url || payload.image?.imageUrl) msgType = "image";
    else if (payload.video || payload.videoUrl || payload.video?.url || payload.video?.videoUrl) msgType = "video";
    else if (payload.document || payload.documentUrl || payload.document?.url || payload.document?.documentUrl) msgType = "document";
    else if (pType === "audio" || pType === "ptt" || pType === "voice") msgType = "audio";
    else if (pType === "image") msgType = "image";
    else if (pType === "video") msgType = "video";
    else if (pType === "document") msgType = "document";

    if (!content && msgType !== "text") {
      const fileName = payload.fileName || payload.document?.fileName || payload.image?.fileName || "";
      content = fileName ? `[Arquivo: ${fileName}]` : `[Mídia: ${msgType}]`;
    }
    if (!content) content = "...";

    let senderName = payload.senderName || payload.pushName;
    if (!fromMe && !senderName) senderName = payload.contact?.name;
    if (fromMe && (!senderName || /^\d+$/.test(senderName.replace(/\D/g, '')))) {
      senderName = "Operador (Celular)";
    } else if (!fromMe) {
      senderName = senderName || chatIdentifier.split('@')[0];
    }

    const senderPhone = (payload.contact?.phone || payload.phone || contactLid).split('@')[0];

    let msgResult = null;
    let msgError = null;

    if (!existingMsg) {
      const insertResult = await supabase.from('messages').insert({
        conversation_id: conv.id,
        sender_type: fromMe ? 'agent' : 'contact',
        sender_name: senderName,
        sender_phone: senderPhone,
        message_type: msgType,
        content: content,
        provider: 'zapi',
        provider_message_id: providerMsgId,
        chat_id: chatLid, // Aqui salvamos o chat_id bruto do webhook
        direction: fromMe ? 'outbound' : 'inbound',
        sent_at: payload.timestamp ? new Date(payload.timestamp).toISOString() : now,
        raw_payload: payload,
        media_url: payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl ||
          payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url ||
          payload.image?.imageUrl || payload.audio?.audioUrl || payload.video?.videoUrl || payload.document?.documentUrl ||
          null,
      }).select('id').single();

      msgResult = insertResult.data;
      msgError = insertResult.error;
    }

    if (msgError) throw new Error(`Falha ao salvar mensagem: ${msgError.message}`);

    // Command Detection & Media Storage follows...
    if (!fromMe && msgResult?.id && msgType === 'text') {
      const employee = await isEmployeeSender(supabase, payload);
      if (employee.isEmployee) {
        const parsed = parseAndExtract(content);
        if (parsed.intent === 'needs_more_info') {
          // Send help message...
          await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversation_id: conv.id,
              content: `📋 Oi, ${employee.profileName}!\n\n${parsed.hint}`,
              message_type: 'text',
              sender_name: 'Sistema'
            })
          });
          return new Response(JSON.stringify({ success: true, needs_more_info: true }), { headers: corsHeaders });
        }
        if (parsed.intent === 'create_protocol') {
          await fetch(`${supabaseUrl}/functions/v1/create-protocol`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversation_id: conv.id,
              condominium_name: parsed.condominiumName,
              summary: parsed.summary,
              priority: parsed.priority || 'normal',
              category: parsed.category || 'operational',
              requester_name: `G7 Serv (${employee.profileName})`,
              requester_role: 'Funcionário',
              created_by_agent_id: employee.profileId,
              created_by_type: 'agent',
              force_new: parsed.forceNew ?? true,
              notify_group: true,
              notify_client: false,
              source_message_id: msgResult.id
            })
          });
          return new Response(JSON.stringify({ success: true, employee_command: true }), { headers: corsHeaders });
        }
      }
    }

    // Media Storage...
    if (msgResult && (msgType === 'audio' || msgType === 'video')) {
      // Cloud storage logic...
    }

    // AI & Group Resolution...
    if (!fromMe && !isGroup && !msgError && msgResult && !existingMsg) {
      const audioUrl = payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl || payload.document?.documentUrl || "";
      if (msgType === 'audio') {
        await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_id: msgResult.id, audio_url: audioUrl, conversation_id: conv.id }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: conv.id }),
        });
      }
    }

    if (!fromMe && isGroup && !msgError && msgResult && !existingMsg && msgType === 'text') {
      await fetch(`${supabaseUrl}/functions/v1/group-resolution-handler`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: msgResult.id,
          conversation_id: conv.id,
          message_text: content,
          group_id: chatLid,
          sender_phone: contactLid,
          sender_name: senderName || 'Desconhecido'
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('[Webhook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: corsHeaders });
  }
});
