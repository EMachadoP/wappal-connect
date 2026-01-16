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

    // --- HELPERS E NORMALIZAÇÃO BLINDADA ---
    const stripPrefix = (s: string) => s.replace(/^(u:|g:)/, '');

    const normalizeGroupJid = (id: string) => {
      let s = (id ?? '').trim().toLowerCase();
      if (!s) return s;
      s = stripPrefix(s);
      s = s.replace(/\s+/g, '');
      const base = s.includes('@') ? s.split('@')[0] : s;
      const base2 = base.endsWith('-group') ? base.slice(0, -'-group'.length) : base;
      return `${base2}@g.us`;
    };

    // --- IDENTIFICAÇÃO E NORMALIZAÇÃO (PATCH DEFINITIVO) ---
    const onlyDigits = (v?: string | null) => (v ?? "").replace(/\D/g, "");

    // ✅ FIX: REGRA 0: @s.whatsapp.net é SEMPRE usuário (mesmo com hífen)
    const isGroup = (id?: string | null) => {
      if (!id) return false;
      const raw = id.trim().toLowerCase();

      // REGRA 0: se termina com @s.whatsapp.net, é USER
      if (raw.endsWith("@s.whatsapp.net")) return false;

      // REGRA 1: @g.us é grupo
      if (raw.includes("@g.us")) return true;

      // REGRA 2: padrão de grupo "5511...-1234" (sem @) OU "...-1234@g.us"
      const stripped = stripPrefix(raw);
      if (/^\d{10,14}-\d+/.test(stripped)) return true;

      return false;
    };

    const isLid = (id?: string | null) => !!id && id.endsWith("@lid");

    const fromMe =
      payload.fromMe === true ||
      payload.fromMe === 1 ||
      payload.fromMe === "true" ||
      payload.fromMe === "1" ||
      Boolean(payload.fromMe);

    // Extrai o melhor telefone possível do payload
    function extractPhone(payload: any, fromMe: boolean) {
      // Quando fromMe, procurar destinatário primeiro (priorizando 'to' e 'recipient')
      // Ajuste: 'phone' muitas vezes é o remetente, então deixamos por último no fromMe
      const candidates = fromMe
        ? [payload.to, payload.recipient, payload.chatName, payload.chatId, payload.phone]
        : [payload.senderPhone, payload.contact?.phone, payload.from, payload.participantPhone, payload.phone, payload.chatId];

      for (const c of candidates) {
        if (!c || typeof c !== 'string') continue;
        // Se for LID ou Grupo, ignora números curtos, pega só se parecer telefone
        if (c.endsWith('@lid') || c.endsWith('@g.us')) continue;

        // ✅ FIX: Se termina com @s.whatsapp.net, extrair dígitos
        if (c.endsWith('@s.whatsapp.net')) {
          const digits = c.split('@')[0].replace(/\D/g, '');
          if (digits.length >= 10) return digits;
          continue;
        }

        const d = onlyDigits(c);
        if (d.length >= 10) return d; // 10+ dígitos (BR normalmente 12-13 com DDI 55)
      }
      return null;
    }

    const rawChatId = payload.chatId || payload.chat?.chatId || payload.id || null;

    // 1. Determinar Thread Key (Identidade Canônica) e Chat ID
    let threadKey: string | null = null;
    let canonicalChatId: string | null = null; // ✅ Agora sempre telefone para pessoa
    let isGroupChat = false;

    if (isGroup(rawChatId) || payload.isGroup) {
      isGroupChat = true;
      const gId = normalizeGroupJid(rawChatId || payload.phone || "");
      threadKey = `g:${gId.replace('@g.us', '')}@g.us`;
      canonicalChatId = gId; // ✅ Para grupo, mantém ...@g.us (JID enviável)
    } else {
      // 1:1: threadKey e chat_id devem ser telefone (estável)
      const phone = extractPhone(payload, fromMe);

      if (phone) {
        // Normalizar BR
        let finalPhone = phone;
        if (finalPhone.startsWith("55") && finalPhone.length > 11) {
          // Aceita
        } else if (finalPhone.length === 10 || finalPhone.length === 11) {
          finalPhone = "55" + finalPhone;
        }
        threadKey = `u:${finalPhone}`;
        // ✅ CRÍTICO: Chat ID = JID enviável (com @s.whatsapp.net)
        canonicalChatId = `${finalPhone}@s.whatsapp.net`;
      } else {
        // ✅ Se não temos telefone real, deixa NULL (forçar identificação)
        console.warn(`[Webhook] Sem telefone válido. Raw: ${JSON.stringify({ rawChatId, fromMe })}. chat_id será NULL.`);
        threadKey = rawChatId ? `u:${rawChatId}` : null; // Thread key pode usar LID
        canonicalChatId = null; // ❌ NÃO INVENTAR chat_id sem telefone
      }
    }

    // Fallback de segurança para não quebrar o fluxo se não achar nada (cria "unidentified")
    let finalChatKey = threadKey;
    let finalChatIdentifier = canonicalChatId || rawChatId || "unknown";

    if (!finalChatKey && (canonicalChatId || rawChatId)) {
      // Último recurso: usa o que tem (mesmo que seja LID) para não perder a msg, 
      // mas loga warning. O ideal seria não usar LID como chave.
      finalChatKey = `u:${canonicalChatId || rawChatId}`; // Temporário
    }

    // Campos auxiliares legacy
    const chatKey = finalChatKey;
    const chatIdentifier = finalChatIdentifier;
    const chatName = payload.chatName || payload.contact?.name || payload.senderName || payload.pushName || 'Desconhecido';

    console.log(`[Webhook] Identity: ${fromMe ? 'OUT' : 'IN'} | Key=${finalChatKey} | Alias=${finalChatIdentifier}`);

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


    // 6. Salvar/Atualizar Conversa com UPSERT
    const nowIso = new Date().toISOString();

    // ✅ FIX: Upsert por chat_id para evitar duplicatas
    const convPayload: any = {
      contact_id: contactId,
      chat_id: finalChatIdentifier,      // Normalizado (ex: 5581997438430 ou 551199-123@g.us)
      thread_key: threadKey,             // Ex: u:5581... ou g:...@g.us
      last_message: lastMessagePreview,
      last_message_type: msgType,
      last_message_at: nowIso,
      status: 'open'
    };

    // Auto-Condominium Selection (apenas para mensagens INBOUND)
    if (!fromMe) {
      const { data: linkedCondos } = await supabase
        .from('contact_condominiums')
        .select('condominium_id, is_default')
        .eq('contact_id', contactId);

      if (linkedCondos && linkedCondos.length > 0) {
        const defaultCondo = linkedCondos.find((lc: any) => lc.is_default);
        const autoCondoId = defaultCondo?.condominium_id || (linkedCondos.length === 1 ? linkedCondos[0].condominium_id : null);

        if (autoCondoId) {
          convPayload.active_condominium_id = autoCondoId;
          convPayload.active_condominium_set_by = 'human';
          convPayload.active_condominium_set_at = nowIso;
        }
      }
    }

    let conv: { id: string };

    // Tentar upsert
    const { data: convRow, error: convErr } = await supabase
      .from('conversations')
      .upsert(convPayload, { onConflict: 'chat_id' })
      .select('id')
      .single();

    if (convErr) {
      // ✅ FALLBACK: Se der erro, tenta recuperar a conversa existente
      console.log(`[Webhook] Erro no upsert, tentando fallback: ${convErr.message}`);

      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('chat_id', finalChatIdentifier)
        .maybeSingle();

      if (!existing) throw new Error(`Erro ao criar/atualizar conversa: ${convErr.message}`);

      conv = existing;

      // Atualizar manualmente
      await supabase
        .from('conversations')
        .update({
          last_message: lastMessagePreview,
          last_message_type: msgType,
          last_message_at: nowIso,
          status: 'open'
        })
        .eq('id', conv.id);
    } else {
      conv = convRow;
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

    const senderPhone = (payload.contact?.phone || payload.phone || finalChatIdentifier).split('@')[0];

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
        chat_id: finalChatIdentifier, // Aqui salvamos o chat_id bruto do webhook
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
          group_id: finalChatKey || finalChatIdentifier,
          sender_phone: senderPhone,
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
