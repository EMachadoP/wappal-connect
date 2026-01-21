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

    // 3. Ignorar apenas chatState e status updates sem conteúdo
    // ❌ NÃO ignorar payload.ack - mensagens inbound podem ter ack!
    const isIgnoredEvent = Boolean(
      payload.type === 'chatState' ||
      (payload.status && !payload.text && !payload.message && !payload.image && !payload.video && !payload.audio && !payload.document)
    );
    if (isIgnoredEvent) {
      console.log('[Webhook] Ignoring event:', payload.type || 'status-only');
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
      if (DEBUG_WEBHOOK) console.warn("Ignored: invalid JID", { rawIdentity });
      return new Response("Ignored: Invalid Identity", { status: 200 });
    }

    // ✅ PATCH 3: REGRA DE OURO - se existe phone válido, a conversa SEMPRE é ancorada no phone JID
    const phoneDigits = normalizedPhone ? String(normalizedPhone).replace(/\D/g, "") : "";
    const hasRealPhone = phoneDigits.length >= 10 && !phoneDigits.endsWith("lid") && !String(normalizedPhone || "").includes("@lid");

    const preferredChatId = hasRealPhone
      ? normalizeChatId(phoneDigits) // vira 55...@s.whatsapp.net
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

    // ✅ 1. RESOLVER/ATUALIZAR CONTATO - Busca robusta por múltiplos identificadores
    let contactId: string;
    
    // Extrair dígitos do phone e LID para busca mais ampla
    const phoneDigits = phone ? phone.replace(/\D/g, '') : '';
    const lidDigits = currentLid ? currentLid.replace(/@lid$/i, '').replace(/\D/g, '') : '';
    const chatIdDigits = canonicalChatIdFinal ? canonicalChatIdFinal.split('@')[0].replace(/\D/g, '') : '';
    
    // Construir query de busca que encontra contato por QUALQUER identificador conhecido
    const searchConditions: string[] = [];
    if (threadKey) searchConditions.push(`chat_key.eq.${threadKey}`);
    if (threadKey) searchConditions.push(`chat_key.eq.${threadKey.replace(/^(u:|g:)/, '')}`);
    if (phoneDigits && phoneDigits.length >= 10) searchConditions.push(`phone.ilike.%${phoneDigits.slice(-8)}%`);
    if (currentLid) searchConditions.push(`chat_lid.eq.${currentLid}`);
    if (currentLid) searchConditions.push(`lid.eq.${currentLid}`);
    if (lidDigits && lidDigits.length >= 10) searchConditions.push(`chat_lid.ilike.%${lidDigits}%`);
    if (chatIdDigits && chatIdDigits.length >= 10 && chatIdDigits !== phoneDigits) {
      searchConditions.push(`phone.ilike.%${chatIdDigits.slice(-8)}%`);
    }
    
    console.log(`[Webhook] 🔍 Buscando contato com condições: ${searchConditions.length} variações`);
    
    const { data: contactFound } = await supabase.from('contacts')
      .select('id, name, chat_key, chat_lid, lid, phone')
      .or(searchConditions.join(','))
      .eq('is_group', isGroupChat)
      .limit(1)
      .maybeSingle();

    if (contactFound) {
      contactId = contactFound.id;
      const updates: any = { updated_at: now };

      // ✅ Cross-linking ROBUSTO: Garantir que TODOS os identificadores estejam presentes
      // Isso evita duplicação quando mensagem chega com LID e depois com phone
      if (currentLid && contactFound.chat_lid !== currentLid) {
        updates.chat_lid = currentLid;
        console.log(`[Webhook] 🔗 Cross-link: adicionando chat_lid ${currentLid} ao contato ${contactFound.id}`);
      }
      if (currentLid && (contactFound as any).lid !== currentLid) {
        (updates as any).lid = currentLid;
      }
      if (phone && contactFound.phone !== phone) {
        // Só atualizar phone se o atual for vazio ou for um LID
        const currentPhone = contactFound.phone || '';
        const currentPhoneIsLid = currentPhone.includes('@lid') || (currentPhone.length >= 14 && !currentPhone.startsWith('55'));
        if (!currentPhone || currentPhoneIsLid) {
          updates.phone = phone;
          console.log(`[Webhook] 🔗 Cross-link: adicionando phone ${phone} ao contato ${contactFound.id} (era: ${currentPhone || 'vazio'})`);
        }
      }

      // Atualizar chat_key para formato consistente
      if (!contactFound.chat_key || !contactFound.chat_key.startsWith('u:') && !contactFound.chat_key.startsWith('g:')) {
        updates.chat_key = threadKey;
      }

      // ✅ Robust Name Update Logic
      const currentName = contactFound.name || "";
      const isNameGeneric = !currentName ||
        currentName === 'Desconhecido' ||
        currentName === 'G7 Serv' ||
        currentName === 'Contact' ||
        currentName === 'Unknown' ||
        /^\d+$/.test(currentName.replace(/\D/g, '')) ||
        (currentName.includes('@') && currentName.length > 15);

      if (isNameGeneric && chatName && chatName !== 'Desconhecido' && chatName !== 'G7 Serv' && !/^\d+$/.test(chatName.replace(/\D/g, ''))) {
        updates.name = chatName;
        console.log(`[Webhook] 🔄 Updating contact name from '${currentName}' to '${chatName}'`);
      }

      await supabase.from('contacts').update(updates).eq('id', contactId);
    } else {
      const { data: newContact, error: insErr } = await supabase.from('contacts').insert({
        chat_key: threadKey,
        chat_id: canonicalChatId,
        chat_lid: currentLid,
        lid: currentLid,
        name: chatName,
        is_group: isGroupChat,
        phone,
        updated_at: now
      }).select('id').single();
      if (insErr || !newContact) throw new Error(`Erro ao criar contato: ${insErr?.message}`);
      contactId = newContact.id;
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

    // ✅ 4. UPSERT CONVERSA (Foco no chat_id canônico)
    // ✅ 4. UPSERT CONVERSA (MANUAL para evitar conflito de Unique Index em thread_key)
    const convPayload: any = {
      chat_id: canonicalChatIdFinal,
      thread_key: threadKey,
      contact_id: contactId,
      last_message: lastMessagePreview.slice(0, 500),
      last_message_type: msgType,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'open'
    };

    // ✅ REGRA DE NEGÓCIO: Mensagem INBOUND sempre volta para "Entradas"
    // Cada nova mensagem do cliente é uma nova oportunidade de atendimento
    // A atribuição só acontece quando operador assume explicitamente no App
    // NÃO reseta assigned_to durante backfill (para não bagunçar atribuições existentes)
    if (!fromMe && !isGroupChat && !isBackfill) {
      convPayload.assigned_to = null; // Reset para "Entradas"
      console.log(`[Webhook] 📥 Mensagem inbound: conversa volta para "Entradas"`);
    }

    // ✅ PATCH 4: Busca segura de conversa com merge sem violar UNIQUE
    // Busca 1: Por contact_id (mais confiável - garante unicidade)
    const { data: convByContact } = await supabase
      .from('conversations')
      .select('id, contact_id, chat_id, thread_key, assigned_to')
      .eq('contact_id', contactId)
      .limit(1)
      .maybeSingle();

    // Busca 2: Por thread_key ou chat_id (múltiplas variações para evitar duplicação)
    const keySearchConditions: string[] = [];
    if (threadKey) keySearchConditions.push(`thread_key.eq.${threadKey}`);
    if (canonicalChatIdFinal) keySearchConditions.push(`chat_id.eq.${canonicalChatIdFinal}`);
    // Também buscar por variações do LID e phone
    if (currentLid) {
      keySearchConditions.push(`chat_id.eq.${currentLid}`);
      keySearchConditions.push(`thread_key.eq.u:${currentLid}`);
    }
    if (phone && !phone.includes('@lid')) {
      const phoneJid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
      keySearchConditions.push(`chat_id.eq.${phoneJid}`);
      keySearchConditions.push(`thread_key.eq.u:${phone}`);
    }
    
    console.log(`[Webhook] 🔍 Buscando conversa com ${keySearchConditions.length} condições`);
    
    const { data: convByKey } = await supabase
      .from('conversations')
      .select('id, contact_id, chat_id, thread_key, assigned_to')
      .or(keySearchConditions.join(','))
      .limit(1)
      .maybeSingle();

    // ✅ MERGE ANTES DO UPDATE: Se existem duas conversas diferentes, merge PRIMEIRO
    if (convByContact && convByKey && convByContact.id !== convByKey.id) {
      console.log(`[Webhook] 🔀 Merge: movendo dados de ${convByKey.id} → ${convByContact.id}`);

      // 1. Mover mensagens
      await supabase
        .from('messages')
        .update({ conversation_id: convByContact.id })
        .eq('conversation_id', convByKey.id);

      // 2. Mover protocolos (se existir tabela)
      await supabase
        .from('protocols')
        .update({ conversation_id: convByContact.id })
        .eq('conversation_id', convByKey.id);

      // 3. DELETAR a conversa perdedora (libera chat_id e contact_id para a vencedora)
      const { error: delErr } = await supabase
        .from('conversations')
        .delete()
        .eq('id', convByKey.id);

      if (delErr) {
        console.error(`[Webhook] Erro ao deletar conversa perdedora ${convByKey.id}:`, delErr);
        // Se não conseguir deletar, pelo menos marca como resolved
        await supabase
          .from('conversations')
          .update({ status: 'resolved', updated_at: new Date().toISOString() })
          .eq('id', convByKey.id);
      } else {
        console.log(`[Webhook] ✅ Conversa duplicada ${convByKey.id} deletada`);
      }
    }

    // ✅ Winner: sempre a conversa do contact_id se existir
    const winner = convByContact ?? convByKey;

    // ✅ PATCH 4: Se winner já tem contact_id diferente, não force contact_id (evita UNIQUE)
    if (winner?.contact_id && winner.contact_id !== contactId) {
      delete convPayload.contact_id;
      console.log(`[Webhook] Mantendo contact_id existente ${winner.contact_id} (evita UNIQUE violation)`);
    }

    // ✅ Se winner já tem chat_id diferente do novo E esse chat_id existe em outra conversa, não force
    // (Isso evita conflito na constraint chat_id_uq_full)
    if (winner?.chat_id && winner.chat_id !== canonicalChatIdFinal) {
      // Verifica se o novo chat_id já existe em outra conversa
      const { data: existingChatIdConv } = await supabase
        .from('conversations')
        .select('id')
        .eq('chat_id', canonicalChatIdFinal)
        .neq('id', winner.id)
        .maybeSingle();

      if (existingChatIdConv) {
        delete convPayload.chat_id;
        delete convPayload.thread_key;
        console.log(`[Webhook] Mantendo chat_id existente ${winner.chat_id} (evita chat_id_uq_full violation)`);
      }
    }

    let conv: any;

    if (winner) {
      // UPDATE
      const { data: updated, error: updateErr } = await supabase
        .from('conversations')
        .update(convPayload)
        .eq('id', winner.id)
        .select('id, assigned_to')
        .single();

      if (updateErr) {
        console.error(`[Webhook] Erro no UPDATE da conversa ${winner.id}:`, updateErr);
        throw updateErr;
      }
      conv = updated;
      console.log(`[Webhook] Conversa atualizada: ${conv.id}`);
    } else {
      // INSERT
      const { data: inserted, error: insertErr } = await supabase
        .from('conversations')
        .insert(convPayload)
        .select('id, assigned_to')
        .single();

      if (insertErr) {
        // Se der erro de duplicação, fazemos uma última tentativa de pegar (race condition)
        if (JSON.stringify(insertErr).includes("duplicate") || insertErr.code === '23505') {
          const { data: racedConv } = await supabase
            .from('conversations')
            .select('id, assigned_to')
            .or(`thread_key.eq.${threadKey},chat_id.eq.${canonicalChatIdFinal}`)
            .maybeSingle();

          if (racedConv) {
            // Remove contact_id do payload para evitar UNIQUE
            delete convPayload.contact_id;
            const { data: racedUpdated } = await supabase
              .from('conversations')
              .update(convPayload)
              .eq('id', racedConv.id)
              .select('id, assigned_to')
              .single();
            conv = racedUpdated;
          } else {
            throw insertErr;
          }
        } else {
          console.error(`[Webhook] Erro no INSERT da conversa:`, insertErr);
          throw insertErr;
        }
      } else {
        conv = inserted;
        console.log(`[Webhook] Nova conversa criada: ${conv.id}`);
      }
    }

    // ✅ PATCH 5: Apenas UM increment_unread_count (não incrementa em backfill)
    if (!fromMe && !isBackfill) await supabase.rpc('increment_unread_count', { conv_id: conv.id });

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
      if (existingMsg.conversation_id !== conv.id) {
        const { error: relinkErr } = await supabase
          .from("messages")
          .update({
            conversation_id: conv.id,
            chat_id: canonicalChatIdFinal,
            raw_payload: payload,
          })
          .eq("id", existingMsg.id);

        if (relinkErr) {
          console.error("[Webhook] Erro ao RELINK mensagem duplicada:", relinkErr);
          throw relinkErr;
        }

        console.log(`[Webhook] Duplicada ${providerMsgId} -> RELINK para conv_id=${conv.id}`);
        return new Response(JSON.stringify({ success: true, duplicated: true, relinked: true }), { status: 200, headers: corsHeaders });
      }

      console.log(`[Webhook] Mensagem duplicada ignorada: ${providerMsgId}`);
      return new Response(JSON.stringify({ success: true, duplicated: true, relinked: false }), { status: 200, headers: corsHeaders });
    }

    // --- INSERT DA MENSAGEM COM TRATAMENTO DE CORRIDA ---
    const { data: msgResult, error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conv.id,
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

        if (racedMsg && racedMsg.conversation_id !== conv.id) {
          await supabase.from("messages").update({ conversation_id: conv.id, chat_id: canonicalChatId, raw_payload: payload }).eq("id", racedMsg.id);
          console.log(`[Webhook] Race duplicada ${providerMsgId} -> RELINK para conv_id=${conv.id}`);
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
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey
            },
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
            body: JSON.stringify({ message_id: msgResult.id, audio_url: audioUrl, conversation_id: conv.id }),
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
            body: JSON.stringify({ conversation_id: conv.id, initial_message_id: msgResult.id }),
          }).then(async r => {
            const text = await r.text();
            console.log(`[Webhook] ai-maybe-reply result: ${r.status} ${text}`);
            if (!r.ok) {
              await supabase.from('ai_logs').insert({
                conversation_id: conv.id,
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
          conversation_id: conv.id,
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
