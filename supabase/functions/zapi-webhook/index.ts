import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { isEmployeeSender } from "../_shared/is-employee.ts";
import { parseAndExtract } from "../_shared/parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- HELPERS PARA IDEMPOTÊNCIA ---
async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildFallbackProviderMsgId(opts: {
  canonicalChatId: string;
  fromMe: boolean;
  msgType: string;
  content: string | null;
  mediaUrl: string | null;
  timestamp: string;
  provider: string;
}) {
  const base = JSON.stringify({
    p: opts.provider,
    c: opts.canonicalChatId,
    fm: opts.fromMe ? 1 : 0,
    t: opts.msgType,
    ts: opts.timestamp,
    ct: (opts.content || "").slice(0, 200),
    mu: opts.mediaUrl || "",
  });
  const hex = await sha256Hex(base);
  return `fallback:${hex.slice(0, 32)}`;
}

function pickFirst(...vals: any[]) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const now = new Date().toISOString();
  let payload: any;

  // ✅ BACKFILL MODE: Detecta header x-backfill para reimportação de mensagens
  // Quando x-backfill: 1, não chama IA e não incrementa unread
  const isBackfill = req.headers.get('x-backfill') === '1';
  if (isBackfill) {
    console.log('[Webhook] 🔄 Backfill mode ativado - não chamará IA nem incrementará unread');
  }

  try {
    payload = await req.json();
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ✅ SINAL DE VIDA: atualiza mesmo em status updates
    // (antes retornava cedo e o monitoramento parecia "parado")
    const { error: heartbeatErr } = await supabase
      .from('zapi_settings')
      .update({ last_webhook_received_at: now })
      .is('team_id', null);
    if (heartbeatErr) {
      console.error('[Webhook] Unable to update last_webhook_received_at:', heartbeatErr);
    }

    // --- LOG DE DEPURAÇÃO (ai_logs) ---
    await supabase.from('ai_logs').insert({
      status: 'webhook_received',
      input_excerpt: JSON.stringify(payload).substring(0, 1000),
      model: 'webhook-debug',
      provider: 'zapi',
      created_at: now
    });

    // ✅ HANDLE MESSAGE STATUS UPDATES (delivered, read, etc) - NOT "received"!
    const statusLower = (payload.status || '').toLowerCase();
    const isStatusUpdate = payload.event === 'message-status-update' ||
      payload.type === 'message-status-update' ||
      (payload.status && payload.messageId && statusLower !== 'received');

    if (isStatusUpdate) {
      const messageId = payload.messageId || payload.whatsapp_message_id || payload.id?.id;
      const status = payload.status?.toLowerCase();
      const timestamp = payload.timestamp || payload.timestampStatus || new Date().toISOString();

      console.log('[Webhook] Status update:', { messageId, status, timestamp });

      if (messageId && status) {
        const updates: any = {};

        if (status === 'delivered' || status === 'sent') {
          updates.delivered_at = timestamp;
          updates.status = 'delivered';
        } else if (status === 'read' || status === 'viewed') {
          updates.delivered_at = updates.delivered_at || timestamp;
          updates.read_at = timestamp;
          updates.status = 'read';
        }

        if (Object.keys(updates).length > 0) {
          const { error } = await supabase
            .from('messages')
            .update(updates)
            .eq('provider', 'zapi')
            .eq('provider_message_id', messageId);

          if (error) {
            console.error('[Webhook] Error updating message status:', error);
          } else {
            console.log(`[Webhook] Updated message ${messageId} to status: ${status}`);
          }
        }
      }

      return new Response('OK - Status processed', { status: 200, headers: corsHeaders });
    }

    // 1. Obter configurações
    const { data: settings } = await supabase.from('zapi_settings')
      .select('forward_webhook_url')
      .is('team_id', null)
      .maybeSingle();

    // 2. ENCAMINHAMENTO
    if (settings?.forward_webhook_url) {
      fetch(settings.forward_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error('[Forward Error]', err));
    }

    // 3. Ignorar apenas chatState e status updates sem conteúdo
    // ❌ NÃO ignorar payload.ack - mensagens inbound podem ter ack!
    const isIgnoredEvent = Boolean(
      payload.type === 'chatState' ||
      (payload.status && !payload.text && !payload.message && !payload.image && !payload.video && !payload.audio && !payload.document)
    );
    if (isIgnoredEvent) {
      console.log('[Webhook] Ignoring event:', payload.type || 'status-only');
      // ✅ LOG: Registrar evento ignorado para diagnóstico
      await supabase.from('ai_logs').insert({
        status: 'webhook_dropped',
        reason: 'ignored_event',
        input_excerpt: `type=${payload.type}, status=${payload.status}`,
        model: 'webhook-drop',
        provider: 'zapi',
        created_at: now
      }).catch(() => { });
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

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

    const onlyDigits = (v?: string | null) => (v ?? "").replace(/\D/g, "");

    function normalizeChatId(input: string) {
      const v0 = (input || "").trim().toLowerCase().replace("@gus", "@g.us");
      if (!v0) return null;

      // ✅ Preserve @lid (never convert to phone JID)
      if (v0.endsWith("@lid")) return v0;

      const left = v0.split("@")[0] || "";
      const hasAt = v0.includes("@");
      const looksGroup = v0.endsWith("@g.us") || left.includes("-");

      if (looksGroup) {
        // group might come without suffix
        const base = hasAt ? v0 : left;
        return base.endsWith("@g.us") ? base : `${base}@g.us`;
      }

      // user: only digits
      const digits = left.replace(/\D/g, "");
      if (!digits) return null;

      // ✅ PATCH 3: Handle LID-like digits by adding @lid suffix (don't reject!)
      // If digits >= 14 and NOT starting with 55 (BR), treat as LID and add suffix
      const isLidLike = digits.length >= 14 && !digits.startsWith('55');
      if (isLidLike) {
        // Return as LID with proper suffix instead of null
        return `${digits}@lid`;
      }

      const br = (digits.length === 10 || digits.length === 11) ? `55${digits}` : digits;
      return `${br}@s.whatsapp.net`;
    }

    const DEBUG_WEBHOOK = Deno.env.get("DEBUG_WEBHOOK") === "1";
    const mask = (s: string) => s ? `${s.slice(0, 4)}***${s.slice(-4)}` : s;

    function threadKeyFromChatId(chatId: string) {
      const cid = (chatId || "").trim().toLowerCase();

      if (cid.endsWith("@g.us")) return `g:${cid}`;
      if (cid.endsWith("@lid")) return `u:${cid}`; // ✅ mantém o @lid inteiro

      return `u:${cid.split("@")[0]}`;
    }

    const fromMeRaw = payload.fromMe;
    const direction = String(payload.direction || '').toLowerCase(); // 'inbound' | 'outbound'

    const fromMe =
      direction === 'outbound' ? true :
        direction === 'inbound' ? false :
          (fromMeRaw === true || fromMeRaw === 1 || fromMeRaw === "true" || fromMeRaw === "1");

    // ✅ AJUSTE: Normalização Robusta - USA CAMPOS NORMALIZADOS DO Z-API
    // Z-API sempre entrega contact.lid e contact.phone normalizados, mesmo quando os raw fields variam
    const rawLid = pickFirst(payload.chatLid, payload.chat_lid, payload?.data?.chatLid);
    const rawPhone = pickFirst(payload.phone, payload?.data?.phone, payload.to, payload.number, payload.recipient);
    const rawChatId = pickFirst(payload.chatId, payload.chat_id, payload?.data?.chatId);

    // ✅ PRIORIDADE: Campos normalizados do Z-API (previne duplicação)
    const normalizedLid = payload.contact?.lid || rawLid;
    const normalizedPhone = payload.contact?.phone || rawPhone;
    const normalizedContactId = payload.contact?.id; // ID único do contato no Z-API

    const isGroup = String(rawChatId || "").includes("@g.us") || String(rawChatId || "").includes("-") || payload.isGroup;

    // ✅ PATCH 3: phone primeiro quando existir (evita 2 conversas)
    let rawIdentity = isGroup
      ? pickFirst(rawChatId)
      : (fromMe
        ? pickFirst(normalizedPhone, rawChatId, normalizedLid)   // OUT: phone primeiro
        : pickFirst(rawChatId, normalizedPhone, normalizedLid)); // IN: chatId/phone antes de LID

    // Validação adicional: se phone parece LID (14+ dígitos), descarta
    if (!isGroup && normalizedPhone && /^\d{14,}$/.test(String(normalizedPhone).replace(/\D/g, '')) && !String(normalizedPhone).startsWith('55')) {
      // É na verdade um LID mascarado vindo no campo phone - use o LID
      rawIdentity = normalizedLid || normalizedPhone;
    }

    if (!rawIdentity) {
      console.warn(`[Webhook] Ignored payload: unable to determine chatId. Raw:`, { rawChatId, normalizedPhone, normalizedLid });
      // ✅ LOG: Registrar drop por falta de identidade
      await supabase.from('ai_logs').insert({
        status: 'webhook_dropped',
        reason: 'no_identity',
        input_excerpt: JSON.stringify({ rawChatId, normalizedPhone, normalizedLid, fromMe }).substring(0, 500),
        model: 'webhook-drop',
        provider: 'zapi',
        created_at: now
      }).catch(() => { });
      return new Response("Ignored: No Identity", { status: 200 });
    }

    const canonicalChatId = normalizeChatId(String(rawIdentity));
    const isGroupChat = canonicalChatId?.endsWith("@g.us") ?? false;

    // Normalize phone and LID for query (use normalized values!)
    const currentLid = normalizedLid ? String(normalizedLid) : null;
    let phone = normalizedPhone ? String(normalizedPhone) : null;

    // Fallback: extract phone from canonical if missing in raw (and not a group)
    if (!phone && !isGroupChat && canonicalChatId) {
      phone = canonicalChatId.split('@')[0];
    }

    if (!canonicalChatId) {
      console.warn("[Webhook] Ignored: invalid JID", { rawIdentity });
      // ✅ LOG: Registrar drop por JID inválido
      await supabase.from('ai_logs').insert({
        status: 'webhook_dropped',
        reason: 'invalid_jid',
        input_excerpt: JSON.stringify({ rawIdentity, normalizedPhone, normalizedLid }).substring(0, 500),
        model: 'webhook-drop',
        provider: 'zapi',
        created_at: now
      }).catch(() => { });
      return new Response("Ignored: Invalid Identity", { status: 200 });
    }

    // ✅ PATCH 3: REGRA DE OURO - se existe phone válido, a conversa SEMPRE é ancorada no phone JID
    const normalizedPhoneDigits = normalizedPhone ? String(normalizedPhone).replace(/\D/g, "") : "";
    const hasRealPhone =
      normalizedPhoneDigits.length >= 10 &&
      !normalizedPhoneDigits.endsWith("lid") &&
      !String(normalizedPhone || "").includes("@lid");

    const preferredChatId = hasRealPhone
      ? normalizeChatId(normalizedPhoneDigits) // vira 55...@s.whatsapp.net
      : canonicalChatId;

    const canonicalChatIdFinal = preferredChatId || canonicalChatId;
    const threadKey = threadKeyFromChatId(canonicalChatIdFinal);

    if (DEBUG_WEBHOOK) {
      console.log(`[Webhook] 📥 Processing ${direction || 'inbound'}:`, { canonicalChatId, threadKey, fromMe, phone, currentLid });
    } else {
      console.log(`[Webhook] 📥 HIT ${direction || 'inbound'} Key=${threadKey} ID=${mask(canonicalChatId)}`);
    }

    // ✅ FIX: O chatName agora segue a direção da mensagem
    let chatName: string;
    if (fromMe) {
      chatName = payload.chatName || payload.contact?.name || payload.recipientName ||
        (canonicalChatId.split('@')[0]) || 'Desconhecido';
    } else {
      chatName = payload.senderName || payload.pushName || payload.contact?.name ||
        payload.chatName || 'Desconhecido';
    }

    console.log(`[Webhook] Identity: ${fromMe ? 'OUT' : 'IN'} | Key=${threadKey} | JID=${canonicalChatId}`);

    // ✅ 1. RESOLVER/ATUALIZAR CONTATO - SELECT + INSERT com fallback

    // Pré-condição: threadKey canônica é OBRIGATÓRIA
    if (!threadKey) {
      console.warn('[Webhook] ❌ Missing threadKey - cannot resolve contact');
      return new Response(JSON.stringify({ ok: false, reason: 'missing_thread_key' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    let contactId: string;

    // Buscar contato existente por chat_key
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, name, phone, chat_lid')
      .eq('chat_key', threadKey)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      console.log(`[Webhook] ✅ Contact encontrado: ${contactId}`);

      // Atualizar campos se necessário
      const updates: any = { updated_at: now };

      if (phone && existingContact.phone !== phone) {
        const currentPhone = existingContact.phone || '';
        const currentPhoneIsLid = currentPhone.includes('@lid') || (currentPhone.length >= 14 && !currentPhone.startsWith('55'));
        if (!currentPhone || currentPhoneIsLid) {
          updates.phone = phone;
        }
      }

      if (currentLid && existingContact.chat_lid !== currentLid) {
        updates.chat_lid = currentLid;
        updates.lid = currentLid;
      }

      const currentName = existingContact.name || "";
      const isNameGeneric = !currentName ||
        currentName === 'Desconhecido' ||
        /^\d+$/.test(currentName.replace(/\D/g, ''));

      if (isNameGeneric && chatName && chatName !== 'Desconhecido' && !/^\d+$/.test(chatName.replace(/\D/g, ''))) {
        updates.name = chatName;
      }

      if (Object.keys(updates).length > 1) {
        await supabase.from('contacts').update(updates).eq('id', contactId);
      }
    } else {
      // Criar novo contato
      console.log(`[Webhook] 📦 Criando novo contact com chat_key: ${threadKey}`);

      const contactPayload: any = {
        chat_key: threadKey,
        is_group: isGroupChat,
        updated_at: now,
      };

      if (currentLid) {
        contactPayload.chat_lid = currentLid;
        contactPayload.lid = currentLid;
      }
      if (phone) {
        contactPayload.phone = phone;
      }

      // ✅ GARANTIR NAME NUNCA NULL (constraint do banco)
      if (chatName && chatName !== 'Desconhecido' && !/^\d+$/.test(chatName.replace(/\D/g, ''))) {
        contactPayload.name = chatName;
      } else {
        // Fallback: usar phone ou threadKey como nome temporário
        contactPayload.name = phone || canonicalChatIdFinal?.split('@')[0] || 'Contato Desconhecido';
      }

      const { data: newContact, error: insertErr } = await supabase
        .from('contacts')
        .insert(contactPayload)
        .select('id')
        .single();

      if (insertErr) {
        // Race condition: outro request criou o contato primeiro
        if (insertErr.code === '23505') {
          console.log('[Webhook] ⚠️ Race condition detectada, buscando contato existente...');
          const { data: raceContact } = await supabase
            .from('contacts')
            .select('id')
            .eq('chat_key', threadKey)
            .single();

          if (raceContact) {
            contactId = raceContact.id;
          } else {
            throw new Error(`Erro ao criar contato: ${insertErr.message}`);
          }
        } else {
          throw new Error(`Erro ao criar contato: ${insertErr.message}`);
        }
      } else {
        contactId = newContact.id;
      }

      console.log(`[Webhook] ✅ Novo contact criado: ${contactId}`);
    }


    // ✅ 3. RESOLVER MÍDIA/CONTEÚDO
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";
    let msgType: "text" | "image" | "video" | "audio" | "document" | "system" = "text";
    const pType = (payload.type || "").toLowerCase();

    if (payload.audio || payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl) msgType = "audio";
    else if (pType.includes("image") || payload.image) msgType = "image";
    else if (pType.includes("video") || payload.video) msgType = "video";
    else if (pType.includes("document") || payload.document) msgType = "document";

    const lastMessagePreview = (content && content.trim()) || `[${msgType}]`;

    // ✅ 4. UPSERT CONVERSA - ATÔMICO (elimina race condition)
    const convPayload: any = {
      chat_id: canonicalChatIdFinal,
      thread_key: threadKey,  // Chave única para UPSERT
      contact_id: contactId,
      last_message: lastMessagePreview.slice(0, 500),
      last_message_type: msgType,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'open'
    };

    // ✅ REGRA DE NEGÓCIO: Mensagem INBOUND sempre volta para "Entradas"
    if (!fromMe && !isGroupChat && !isBackfill) {
      convPayload.assigned_to = null;
      console.log(`[Webhook] 📥 Mensagem inbound: conversa volta para "Entradas"`);
    }

    // ✅ MERGE PRÉ-UPSERT: Se existem conversas órfãs com mesmo contact_id, merge PRIMEIRO
    const { data: orphanConvs } = await supabase
      .from('conversations')
      .select('id, thread_key')
      .eq('contact_id', contactId)
      .neq('thread_key', threadKey)
      .limit(5);

    if (orphanConvs && orphanConvs.length > 0) {
      console.log(`[Webhook] 🔀 Encontradas ${orphanConvs.length} conversas órfãs para merge`);

      for (const orphan of orphanConvs) {
        // Mover mensagens para a conversa principal (que será criada/atualizada)
        const { data: mainConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('thread_key', threadKey)
          .maybeSingle();

        if (mainConv) {
          await supabase.from('messages').update({ conversation_id: mainConv.id }).eq('conversation_id', orphan.id);
          await supabase.from('protocols').update({ conversation_id: mainConv.id }).eq('conversation_id', orphan.id);
          await supabase.from('conversations').delete().eq('id', orphan.id);
          console.log(`[Webhook] ✅ Conversa órfã ${orphan.id} merged para ${mainConv.id}`);
        }
      }
    }

    console.log(`[Webhook] 📦 Buscando/criando conversation com thread_key: ${threadKey}`);

    // SELECT + INSERT para conversations (índice UNIQUE parcial não suporta ON CONFLICT)
    let convId: string;
    let convAssignedTo: string | null = null;

    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id, assigned_to')
      .eq('thread_key', threadKey)
      .maybeSingle();

    if (existingConv) {
      convId = existingConv.id;
      convAssignedTo = existingConv.assigned_to;
      console.log(`[Webhook] ✅ Conversation encontrada: ${convId}`);

      // Atualizar campos
      await supabase
        .from('conversations')
        .update({
          last_message: lastMessagePreview.slice(0, 500),
          last_message_type: msgType,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: 'open',
          ...((!fromMe && !isGroupChat && !isBackfill) ? { assigned_to: null } : {})
        })
        .eq('id', convId);
    } else {
      // Criar nova conversation
      const { data: newConv, error: insertErr } = await supabase
        .from('conversations')
        .insert(convPayload)
        .select('id, assigned_to')
        .single();

      if (insertErr) {
        // Race condition: outro request criou a conversa primeiro
        if (insertErr.code === '23505') {
          console.log('[Webhook] ⚠️ Race condition em conversation, buscando existente...');
          const { data: raceConv } = await supabase
            .from('conversations')
            .select('id, assigned_to')
            .eq('thread_key', threadKey)
            .single();

          if (raceConv) {
            convId = raceConv.id;
            convAssignedTo = raceConv.assigned_to;

            // IMPORTANTE: Atualizar campos mesmo após race condition
            await supabase
              .from('conversations')
              .update({
                last_message: lastMessagePreview.slice(0, 500),
                last_message_type: msgType,
                last_message_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                status: 'open',
                ...((!fromMe && !isGroupChat && !isBackfill) ? { assigned_to: null } : {})
              })
              .eq('id', convId);
            console.log(`[Webhook] ✅ Conversation atualizada após race condition: ${convId}`);
          } else {
            throw new Error(`Erro ao criar conversation: ${insertErr.message}`);
          }
        } else {
          throw new Error(`Erro ao criar conversation: ${insertErr.message}`);
        }
      } else {
        convId = newConv.id;
        convAssignedTo = newConv.assigned_to;
        console.log(`[Webhook] ✅ Nova conversation criada: ${convId}`);
      }
    }

    console.log(`[Webhook] ✅ Conversation resolvida: ${convId}`);

    // ✅ PATCH 5: Apenas UM increment_unread_count (não incrementa em backfill)
    if (!fromMe && !isBackfill) await supabase.rpc('increment_unread_count', { conv_id: convId });

    // ✅ UPGRADE CONVERSATION: Desabilitado para evitar conflito chat_id_uq_full
    // O merge de conversas já trata a consolidação de LID → phone




    // 7. Salvar Mensagem
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
      senderName = senderName || canonicalChatIdFinal.split('@')[0];
    }

    const senderPhone = (payload.contact?.phone || payload.phone || canonicalChatId).split('@')[0];

    const mediaUrl =
      payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl ||
      payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url ||
      payload.image?.imageUrl || payload.audio?.audioUrl || payload.video?.videoUrl || payload.document?.documentUrl ||
      null;

    // --- IDEMPOTÊNCIA COM RELINK E FALLBACK SEGURO ---
    let providerMsgId = payload.messageId || payload.id;

    if (!providerMsgId) {
      const tsIso = payload.timestamp ? new Date(payload.timestamp).toISOString() : now;
      providerMsgId = await buildFallbackProviderMsgId({
        canonicalChatId,
        fromMe: !!fromMe,
        msgType,
        content: content ?? null,
        mediaUrl: mediaUrl,
        timestamp: tsIso,
        provider: "zapi",
      });
    }

    const { data: existingMsg, error: existingErr } = await supabase
      .from("messages")
      .select("id, conversation_id")
      .eq("provider", "zapi")
      .eq("provider_message_id", providerMsgId)
      .maybeSingle();

    if (existingErr) {
      console.error("[Webhook] Erro ao checar duplicidade:", existingErr);
      throw existingErr;
    }

    if (existingMsg) {
      if (existingMsg.conversation_id !== convId) {
        const { error: relinkErr } = await supabase
          .from("messages")
          .update({
            conversation_id: convId,
            chat_id: canonicalChatIdFinal,
            raw_payload: payload,
          })
          .eq("id", existingMsg.id);

        if (relinkErr) {
          console.error("[Webhook] Erro ao RELINK mensagem duplicada:", relinkErr);
          throw relinkErr;
        }

        console.log(`[Webhook] Duplicada ${providerMsgId} -> RELINK para conv_id=${convId}`);
        return new Response(JSON.stringify({ success: true, duplicated: true, relinked: true }), { status: 200, headers: corsHeaders });
      }

      console.log(`[Webhook] Mensagem duplicada ignorada: ${providerMsgId}`);
      return new Response(JSON.stringify({ success: true, duplicated: true, relinked: false }), { status: 200, headers: corsHeaders });
    }

    // --- INSERT DA MENSAGEM COM TRATAMENTO DE CORRIDA ---
    const { data: msgResult, error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: convId,
        sender_type: fromMe ? "agent" : "contact",
        sender_name: senderName,
        sender_phone: senderPhone,
        message_type: msgType,
        content,
        provider: "zapi",
        provider_message_id: providerMsgId,
        chat_id: canonicalChatIdFinal,
        direction: fromMe ? "outbound" : "inbound",
        sent_at: payload.timestamp ? new Date(payload.timestamp).toISOString() : now,
        raw_payload: payload,
        media_url: mediaUrl,
      })
      .select("id")
      .single();

    if (msgError) {
      const msgErrStr = JSON.stringify(msgError);
      if (msgErrStr.includes("duplicate key") || msgErrStr.includes("23505")) {
        const { data: racedMsg } = await supabase
          .from("messages")
          .select("id, conversation_id")
          .eq("provider", "zapi")
          .eq("provider_message_id", providerMsgId)
          .maybeSingle();

        if (racedMsg && racedMsg.conversation_id !== convId) {
          await supabase.from("messages").update({ conversation_id: convId, chat_id: canonicalChatId, raw_payload: payload }).eq("id", racedMsg.id);
          console.log(`[Webhook] Race duplicada ${providerMsgId} -> RELINK para conv_id=${convId}`);
          return new Response(JSON.stringify({ success: true, duplicated: true, relinked: true, raced: true }), { status: 200, headers: corsHeaders });
        }
        console.log(`[Webhook] Race duplicada ignorada: ${providerMsgId}`);
        return new Response(JSON.stringify({ success: true, duplicated: true, relinked: false, raced: true }), { status: 200, headers: corsHeaders });
      }
      throw msgError;
    }

    // Command Detection & Media Storage follows...
    if (!fromMe && msgResult?.id && msgType === 'text') {
      const employee = await isEmployeeSender(supabase, payload);
      if (employee.isEmployee) {
        const parsed = parseAndExtract(content);
        if (parsed.intent === 'needs_more_info') {
          // Send help message...
          await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey
            },
            body: JSON.stringify({
              conversation_id: convId,
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
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey
            },
            body: JSON.stringify({
              conversation_id: convId,
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
    // ✅ PASSO 3: A IA não deve rodar quando a mensagem for duplicada ou em backfill
    if (!fromMe && !isGroupChat && !isBackfill && !msgError && msgResult && (existingMsg === null || existingMsg === undefined)) {
      if (!msgResult?.id) {
        console.log("[Webhook] Skipping AI: No message ID");
        return new Response(JSON.stringify({ success: true, skipped_ai: "no_message_id" }), { headers: corsHeaders });
      }

      const audioUrl = payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl || payload.document?.documentUrl || "";

      // ✅ PASSO 2: Webhook NUNCA pode “morrer” por erro de IA
      try {
        if (msgType === 'audio') {
          fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'apikey': supabaseServiceKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message_id: msgResult.id, audio_url: audioUrl, conversation_id: convId }),
          }).catch(err => console.error('[Webhook] transcription call failed (background):', err));
        } else {
          // Chamada para ai-maybe-reply
          fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'apikey': supabaseServiceKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ conversation_id: convId, initial_message_id: msgResult.id }),
          }).then(async r => {
            const text = await r.text();
            console.log(`[Webhook] ai-maybe-reply result: ${r.status} ${text}`);
            if (!r.ok) {
              await supabase.from('ai_logs').insert({
                conversation_id: convId,
                status: 'error',
                error_message: `ai-maybe-reply failed: ${r.status} ${text}`,
                model: 'webhook-handler'
              });
            }
          }).catch(err => console.error('[Webhook] ai-maybe-reply failed (background):', err));
        }
      } catch (aiErr) {
        console.error('[Webhook] AI/Transcription invocation error (non-fatal):', aiErr);
      }
    }

    if (!fromMe && isGroupChat && !isBackfill && !msgError && msgResult && !existingMsg && msgType === 'text') {
      await fetch(`${supabaseUrl}/functions/v1/group-resolution-handler`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey
        },
        body: JSON.stringify({
          message_id: msgResult.id,
          conversation_id: convId,
          message_text: content,
          group_id: threadKey || canonicalChatIdFinal,
          sender_phone: senderPhone,
          sender_name: senderName || 'Desconhecido'
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('[Webhook Error]', error.message);
    // ✅ PASSO 2: Webhook NUNCA deve retornar 500 para retries da Z-API se a mensagem foi tratada
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 200, headers: corsHeaders });
  }
});
