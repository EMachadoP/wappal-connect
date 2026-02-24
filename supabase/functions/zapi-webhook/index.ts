import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isEmployeeSender } from "../_shared/is-employee.ts";
import { parseAndExtract } from "../_shared/parse.ts";
import { extractIdentity, normalizePhoneBR, normalizeChatId, threadKeyFromChatId } from "../_shared/wa-id.ts";

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

// ✅ FIX: Detecta se um valor que parece "phone" é na verdade um ID de grupo
// Formato típico: 558197438430-1496317602 (phone-timestamp)
function looksLikeGroupId(value: string | null | undefined): boolean {
  if (!value) return false;
  const s = String(value).replace(/\D/g, '');
  // Grupo: 20-25 dígitos (phone 12-13 + timestamp 10)
  // OU contém hífen no formato phone-timestamp
  return /^\d{12,13}-\d{10}$/.test(String(value)) ||
    (/^\d{20,25}$/.test(s) && !s.startsWith('55'));
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const now = new Date().toISOString();
  let payload: any;

  // ✅ Persistence flags para error handling inteligente
  let persistedMessage = false;
  let isInvalidPayload = false;

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
      const messageId = payload.messageId || payload.whatsapp_message_id || payload.id?.id || payload.id;
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

    // 3. Ignorar apenas chatState e status updates sem NENHUM conteúdo
    // ✅ IMPORTANTE: Verificar TODOS os campos que são usados na extração (linha 385)
    const hasAnyContent = Boolean(
      payload.text?.message || payload.message?.text || payload.body || payload.caption ||
      payload.image || payload.video || payload.audio || payload.document
    );

    const isIgnoredEvent = Boolean(
      payload.type === 'chatState' ||
      (payload.status && !hasAnyContent)
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
      });
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // --- HELPERS E NORMALIZAÇÃO BLINDADA ---
    const stripPrefix = (s: string) => s.replace(/^(u:|g:)/, '');

    const normalizeGroupJid = (id: string) => {
      let s = (id ?? '').trim().toLowerCase();
      if (!s) return s;
      s = stripPrefix(s);
      s = s.replace(/\s+/g, '');
      const baseRaw = s.includes('@') ? s.split('@')[0] : s;
      const base = baseRaw.endsWith('-group') ? baseRaw.slice(0, -'-group'.length) : baseRaw;

      // ✅ FIX: Injetar hífen em IDs de grupo formato [criador][timestamp] se estiver faltando
      // Ex: 5581974384301496317602 -> 558197438430-1496317602
      if (!base.includes('-') && /^\d{18,22}$/.test(base)) {
        // Assume os últimos 10 dígitos como timestamp (padrão WhatsApp)
        const phonePart = base.slice(0, -10);
        const timestampPart = base.slice(-10);
        const dashVersion = `${phonePart}-${timestampPart}@g.us`;
        console.log(`[Webhook] Normalizing group JID: ${base} -> ${dashVersion}`);
        return dashVersion;
      }

      return `${base}@g.us`;
    };

    const DEBUG_WEBHOOK = Deno.env.get("DEBUG_WEBHOOK") === "1";
    const mask = (s: string) => s ? `${s.slice(0, 4)}***${s.slice(-4)}` : s;

    const fromMeRaw = payload.fromMe;
    const direction = String(payload.direction || '').toLowerCase(); // 'inbound' | 'outbound'

    const fromMe =
      direction === 'outbound' ? true :
        direction === 'inbound' ? false :
          (fromMeRaw === true || fromMeRaw === 1 || fromMeRaw === "true" || fromMeRaw === "1");

    // ✅ Helper: extrai id do provider (mesmo padrão do send-message)
    function extractProviderMessageId(p: any): string | null {
      return (
        p?.messageId ||
        p?.statusId ||
        p?.zapiMessageId ||
        p?.id ||
        p?.message?.id ||
        null
      );
    }

    // ✅ AJUSTE: Normalização Robusta - USA CAMPOS NORMALIZADOS DO Z-API
    // Z-API sempre entrega contact.lid e contact.phone normalizados, mesmo quando os raw fields variam
    const rawLid = pickFirst(payload.chatLid, payload.chat_lid, payload?.data?.chatLid);
    const rawPhone = pickFirst(payload.phone, payload?.data?.phone, payload.to, payload.number, payload.recipient);
    const rawChatId = pickFirst(payload.chatId, payload.chat_id, payload?.data?.chatId);

    // ✅ PRIORIDADE: Campos normalizados do Z-API (previne duplicação)
    const normalizedLid = payload.contact?.lid || rawLid;
    const normalizedPhone = payload.contact?.phone || rawPhone;
    const normalizedContactId = payload.contact?.id; // ID único do contato no Z-API

    // ✅ FIX: Detectar grupo mesmo quando vem mascarado no campo phone
    const isGroup = String(rawChatId || "").includes("@g.us") ||
      String(rawChatId || "").includes("-") ||
      payload.isGroup ||
      looksLikeGroupId(normalizedPhone); // ✅ NOVO: detecta grupo no phone

    // ✅ PATCH 3: phone primeiro quando existir (evita 2 conversas)
    // ✅ FIX: Se phone parece grupo, usa ele como chatId do grupo
    let rawIdentity: string | null;

    if (isGroup) {
      // Para grupos: prioriza chatId, mas se phone parecer grupo, usa phone
      if (looksLikeGroupId(normalizedPhone) && !rawChatId) {
        rawIdentity = normalizedPhone;
        console.log(`[Webhook] 🔄 Phone detectado como Group ID: ${normalizedPhone}`);
      } else {
        rawIdentity = rawChatId;
      }
    } else if (fromMe) {
      rawIdentity = pickFirst(normalizedPhone, rawChatId, normalizedLid);
    } else {
      rawIdentity = pickFirst(rawChatId, normalizedPhone, normalizedLid);
    }

    // Validação adicional: se phone parece LID (14+ dígitos), descarta
    if (!isGroup && normalizedPhone && /^\d{14,}$/.test(String(normalizedPhone).replace(/\D/g, '')) && !String(normalizedPhone).startsWith('55')) {
      // É na verdade um LID mascarado vindo no campo phone - use o LID
      rawIdentity = normalizedLid || normalizedPhone;
    }

    if (!rawIdentity) {
      console.warn(`[Webhook] Ignored payload: unable to determine chatId. Raw:`, {
        rawChatId,
        normalizedPhone,
        normalizedLid,
        isGroup,
        looksLikeGroup: looksLikeGroupId(normalizedPhone)
      });
      isInvalidPayload = true;
      // ✅ LOG: Registrar drop por falta de identidade
      await supabase.from('ai_logs').insert({
        status: 'webhook_dropped',
        reason: 'no_identity',
        input_excerpt: JSON.stringify({ rawChatId, normalizedPhone, normalizedLid, fromMe }).substring(0, 500),
        model: 'webhook-drop',
        provider: 'zapi',
        created_at: now
      });
      return new Response("Ignored: No Identity", { status: 400 });
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
      isInvalidPayload = true;
      // ✅ LOG: Registrar drop por JID inválido
      await supabase.from('ai_logs').insert({
        status: 'webhook_dropped',
        reason: 'invalid_jid',
        input_excerpt: JSON.stringify({ rawIdentity, normalizedPhone, normalizedLid }).substring(0, 500),
        model: 'webhook-drop',
        provider: 'zapi',
        created_at: now
      });
      return new Response("Ignored: Invalid Identity", { status: 400 });
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

    const canonicalChatIdFinal = isGroupChat
      ? normalizeGroupJid(canonicalChatId || rawChatId || '')  // ✅ FIX: Ensure string
      : (preferredChatId || canonicalChatId);
    const hitKey = threadKeyFromChatId(canonicalChatIdFinal);

    if (DEBUG_WEBHOOK) {
      console.log(`[Webhook] 📥 Processing ${direction || 'inbound'}:`, { canonicalChatId, hitKey, fromMe, phone, currentLid });
    } else {
      console.log(`[Webhook] 📥 HIT ${direction || 'inbound'} Key=${hitKey} ID=${mask(canonicalChatId)}`);
    }

    // ✅ FIX: Conversation naming prioritization
    let chatName: string;
    if (isGroupChat) {
      // For groups, always prioritize the group's name from multiple sources
      chatName = payload.chatName || payload.contact?.name || payload.senderName || 'Grupo sem nome';
    } else if (fromMe) {
      chatName = payload.chatName || payload.contact?.name || payload.recipientName ||
        (canonicalChatId.split('@')[0]) || 'Desconhecido';
    } else {
      // For DMs, prioritize the sender's own name
      chatName = payload.senderName || payload.pushName || payload.contact?.name ||
        payload.chatName || 'Desconhecido';
    }

    console.log(`[Webhook] Identity: ${fromMe ? 'OUT' : 'IN'} | Key=${hitKey} | JID=${canonicalChatId}`);

    // ✅ 1. RESOLVER CONTATO / GRUPO (Algoritmo LID-first)
    let contactId: string | null = null;
    const identity = extractIdentity(payload);

    if (isGroupChat) {
      console.log(`[Webhook] 👥 Grupo detectado. ThreadKey=${identity.chatKey}`);
    } else {
      console.log(`[Webhook] 🔍 Resolvendo contato (LID-first):`, identity);

      const { lid, phoneE164 } = identity;
      let contact: any = null;

      if (lid) {
        // 1. Tenta por LID
        const { data: byLid } = await supabase
          .from("contacts")
          .select("id, lid, phone_e164")
          .eq("lid", lid)
          .maybeSingle();

        if (byLid) {
          contact = byLid;
          // Merge phone se veio no payload e não tinha no banco
          if (phoneE164 && !contact.phone_e164) {
            await supabase.from("contacts").update({ phone_e164: phoneE164 }).eq("id", contact.id);
          }
        } else if (phoneE164) {
          // 2. Tenta por Phone para reconciliar
          const { data: byPhone } = await supabase
            .from("contacts")
            .select("id, lid, phone_e164")
            .eq("phone_e164", phoneE164)
            .maybeSingle();

          if (byPhone) {
            contact = byPhone;
            // Merge LID no registro antigo
            await supabase.from("contacts").update({ lid }).eq("id", contact.id);
            console.log(`[Webhook] 🔀 Reconciliado por phone: ${phoneE164} -> adicionado LID ${lid}`);
          }
        }
      } else if (phoneE164) {
        // Fallback apenas por phone
        const { data: byPhoneOnly } = await supabase
          .from("contacts")
          .select("id, lid, phone_e164")
          .eq("phone_e164", phoneE164)
          .maybeSingle();
        contact = byPhoneOnly;
      }

      const nameToSet = chatName && chatName !== 'Desconhecido' && !/^\d+$/.test(chatName.replace(/\D/g, '')) ? chatName : null;

      if (!contact) {
        // 3. Criar novo
        const { data: newContact, error: createErr } = await supabase
          .from("contacts")
          .insert({
            lid,
            phone_e164: phoneE164,
            name: nameToSet || "Contato Novo",
          })
          .select("id")
          .single();

        if (createErr) {
          console.error("[Webhook] Erro ao criar contato:", createErr);
          // Pode ter ocorrido race condition, tenta achar de novo
          if (lid) {
            const { data: retry } = await supabase.from("contacts").select("id").eq("lid", lid).maybeSingle();
            contactId = retry?.id || null;
          }
        } else {
          contactId = newContact?.id;
        }
      } else {
        contactId = contact.id;
        // Atualiza nome se necessário
        if (nameToSet && (!contact.name || contact.name === 'Desconhecido')) {
          await supabase.from("contacts").update({ name: nameToSet }).eq("id", contact.id);
        }
      }

      if (!contactId) {
        throw new Error('[zapi-webhook] missing contactId after reconciliation');
      }

      console.log(`[Webhook] ✅ Contato resolvido: ${contactId}`);
    }

    // ✅ Thread key CANÔNICA (usando a identidade extraída)
    const finalThreadKey = isGroupChat
      ? `group:${normalizeGroupJid(identity.chatKey || canonicalChatIdFinal)}`
      : `dm:${contactId}`;

    // ✅ 3. RESOLVER MÍDIA/CONTEÚDO
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";
    let msgType: "text" | "image" | "video" | "audio" | "document" | "system" = "text";
    const pType = (payload.type || "").toLowerCase();

    if (payload.audio || payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl) msgType = "audio";
    else if (pType.includes("image") || payload.image) msgType = "image";
    else if (pType.includes("video") || payload.video) msgType = "video";
    else if (pType.includes("document") || payload.document) msgType = "document";

    const lastMessagePreview = (content && content.trim()) || `[${msgType}]`;

    // ✅ UPSERT CONVERSATION (atômico)
    const convPayload: any = {
      chat_id: canonicalChatIdFinal,
      thread_key: finalThreadKey,
      contact_id: contactId,
      title: isGroupChat ? (payload.chatName || 'Grupo') : null, // ✅ Prevent participant name overwrite
      last_message: lastMessagePreview.slice(0, 500),
      last_message_type: msgType,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "open",
      is_group: isGroupChat,
    };

    // ✅ REGRA DE NEGÓCIO: Mensagem INBOUND sempre volta para "Entradas"
    if (!fromMe && !isGroupChat && !isBackfill) {
      convPayload.assigned_to = null;
      console.log(`[Webhook] 📥 Mensagem inbound: conversa volta para "Entradas"`);
    }

    console.log(`[Webhook] 📦 Upsert conversation thread_key=${finalThreadKey}`);

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .upsert(convPayload, { onConflict: "thread_key" })
      .select("id, assigned_to")
      .single();

    if (convErr) {
      console.error("[Webhook] ❌ Conversation upsert failed:", convErr);
      throw new Error(`Conversation upsert failed: ${convErr.message}`);
    }

    const convId: string = conv.id;
    const convAssignedTo: string | null = conv.assigned_to;

    // ✅ MERGE ÓRFÃS (agora a principal já existe)
    const { data: orphanConvs } = await supabase
      .from("conversations")
      .select("id, thread_key")
      .eq('contact_id', contactId)
      .neq("id", convId)
      .limit(10);

    if (orphanConvs && orphanConvs.length > 0) {
      console.log(`[Webhook] 🔀 Merge de ${orphanConvs.length} conversas órfãs -> ${convId}`);

      const orphanIds = orphanConvs.map(o => o.id);

      await supabase.from("messages")
        .update({ conversation_id: convId })
        .in("conversation_id", orphanIds);

      await supabase.from("protocols")
        .update({ conversation_id: convId })
        .in("conversation_id", orphanIds);

      await supabase.from("conversations")
        .delete()
        .in("id", orphanIds);
    }

    console.log(`[Webhook] ✅ Conversation resolvida: ${convId} (thread_key=${finalThreadKey})`);

    // ✅ HUMAN TAKEOVER via WhatsApp (celular/web): fromMe=true e NÃO foi a IA que enviou.
    if (fromMe === true && !isStatusUpdate) {
      const providerMessageId = extractProviderMessageId(payload);

      let sentByAssistant = false;
      if (providerMessageId) {
        const { data: msgRow, error: msgLookupErr } = await supabase
          .from("messages")
          .select("sender_type")
          .eq("provider", "zapi")
          .eq("provider_message_id", providerMessageId)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (msgLookupErr) {
          console.warn("[Webhook] provider message lookup failed", msgLookupErr);
        }
        sentByAssistant = msgRow?.sender_type === "assistant";
      }

      if (!sentByAssistant) {
        const { error: disableErr } = await supabase
          .from("conversations")
          .update({
            ai_mode: "OFF",
            human_control: true,
            human_control_at: now,
            last_human_message_at: now,
            ai_paused_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          })
          .eq("id", convId);

        if (disableErr) {
          console.warn("[Webhook] failed to disable AI after human WhatsApp reply", disableErr);
        } else {
          console.log("[Webhook] Outbound human message detected -> AI disabled", {
            conversation_id: convId,
            providerMessageId,
          });
        }
      } else {
        console.log("[Webhook] Outbound message is AI-sent (assistant) -> keep AI mode", {
          conversation_id: convId,
          providerMessageId,
        });
      }
    }

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
        canonicalChatId: canonicalChatIdFinal,
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

    if (!msgError && msgResult) {
      persistedMessage = true; // ✅ Marcamos que a mensagem foi persistida
    }

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
          await supabase.from("messages").update({ conversation_id: convId, chat_id: canonicalChatIdFinal, raw_payload: payload }).eq("id", racedMsg.id);
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
          group_id: normalizeGroupJid(rawChatId || canonicalChatIdFinal || canonicalChatId),
          sender_phone: senderPhone,
          sender_name: senderName || 'Desconhecido'
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('[Webhook Error]', error.message);

    // ✅ ERROR HANDLING INTELIGENTE:
    // - 400: Payload inválido (retry não adianta)
    // - 200: Mensagem já persistida (retry duplicaria)
    // - 500: Falha antes de persistir (retry necessário)

    let status = 500; // default: retry

    if (isInvalidPayload) {
      status = 400; // payload ruim, retry não ajuda
    } else if (persistedMessage) {
      status = 200; // já salvou, não precisa retry
    }

    return new Response(
      JSON.stringify({ success: false, error: error.message, persisted: persistedMessage }),
      { status, headers: corsHeaders }
    );
  }
});
