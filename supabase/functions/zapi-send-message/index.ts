import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json = Record<string, any>;

const toBool = (v: any) => v === true || v === "true" || v === 1 || v === "1";

const stripPrefix = (s: string) => (s || '').trim().replace(/^(u:|g:)/i, '');

const isLikelyGroupId = (raw: string) => {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return false;
  if (s.endsWith("@g.us")) return true;
  if (/^\d{10,14}-\d+$/.test(stripPrefix(s))) return true; // 5511999999999-123
  if (s.endsWith("-group")) return true;
  return false;
};

const normalizeGroupJid = (id: string) => {
  let s = (id ?? "").trim().toLowerCase();
  if (!s) return s;
  s = stripPrefix(s);
  s = s.replace(/\s+/g, "");
  const base = s.includes("@") ? s.split("@")[0] : s;
  const base2 = base.endsWith("-group") ? base.slice(0, -"-group".length) : base;
  return `${base2}@g.us`;
};

const normalizeUserId = (id: string) => {
  let s = (id ?? "").trim().toLowerCase();
  if (!s) return s;
  s = stripPrefix(s);
  if (s.endsWith("@lid")) return s; // LID deve ser preservado
  if (s.includes("@")) s = s.split("@")[0];
  return s.replace(/\D/g, "");
};

const getChatKey = (id: string | null | undefined, isGrp: boolean) => {
  if (!id) return null;
  const raw = id.trim().toLowerCase();

  if (raw.startsWith("g:")) return `g:${normalizeGroupJid(raw)}`;
  if (raw.startsWith("u:")) {
    let digits = normalizeUserId(raw);
    if (!digits) return null;
    if (digits.endsWith("@lid")) return `u:${digits}`; // LID-first
    if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
    return `u:${digits}`;
  }

  const group = !!isGrp || isLikelyGroupId(raw);
  if (group) return `g:${normalizeGroupJid(raw)}`;

  let digits = normalizeUserId(raw);
  if (!digits) return null;
  if (digits.endsWith("@lid")) return `u:${digits}`; // LID-first
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return `u:${digits}`;
};

const looksLikeGroup = (raw: string) => {
  const s = stripPrefix((raw || "").trim().toLowerCase());
  return s.endsWith("@g.us") || /^\d{10,14}-\d+$/.test(s.split("@")[0]);
};

const formatForZAPI = (id: string, isGrp: boolean): string => {
  if (!id) return id as any;

  let clean = stripPrefix(id.trim().toLowerCase());

  // ✅ FIX: Rejeitar LIDs para usuários individuais - Z-API não aceita
  if (!isGrp && clean.includes('@lid')) {
    throw new Error(`Tentativa de enviar para LID (${clean}) sem telefone real. Contato precisa ter phone cadastrado.`);
  }

  // Remove any existing suffix first
  if (clean.includes('@')) {
    clean = clean.split('@')[0];
  }

  // ✅ Validar se é um número válido (13 dígitos: 55 + DDD + 9 dígitos)
  if (!isGrp) {
    const onlyDigits = clean.replace(/\D/g, '');
    if (onlyDigits.length < 11 || onlyDigits.length > 14) {
      throw new Error(`Número inválido para Z-API: ${clean} (após sanitização: ${onlyDigits}). Deve ter 11-14 dígitos.`);
    }
  }

  // Para grupos, adicionar @g.us (Z-API aceita para grupos)
  // Para usuários individuais, retornar apenas os dígitos (Z-API rejeita @s.whatsapp.net)
  return isGrp ? `${clean}@g.us` : clean;
};

// ✅ GATEKEEPER DEFINITIVO: Normaliza e valida destinatário antes de enviar
function normalizeRecipient(input: { recipient: string; isGroup?: boolean }): { to_chat_id: string; isGroup: boolean } {
  const raw0 = (input.recipient || "").trim();
  if (!raw0) throw new Error("Destinatário vazio.");

  // Remove u:/g: e normaliza caixa
  const raw = stripPrefix(raw0).trim().toLowerCase();

  // Detectar grupo por marcação OU formato
  const isGroup = !!input.isGroup || looksLikeGroup(raw) || raw.includes("@g.us");

  if (isGroup) {
    // Aceita "551199...-123", "551199...-123@g.us", "g:...."
    const jid = normalizeGroupJid(raw);
    if (!jid.endsWith("@g.us")) throw new Error(`Grupo inválido: "${raw0}"`);
    return { to_chat_id: jid, isGroup: true };
  }

  // Pessoa: bloquear LID
  if (raw.includes("@lid")) {
    throw new Error("Contato sem telefone válido. Não é permitido enviar por LID. Cadastre o phone do contato.");
  }

  // Remover sufixo legado
  const withoutSuffix = raw.replace(/@s\.whatsapp\.net$/i, "");

  // Só dígitos
  const digits = withoutSuffix.replace(/\D/g, "");

  // BR/E.164 (12 ou 13 dígitos com 55)
  if (!digits.startsWith("55") || (digits.length !== 12 && digits.length !== 13)) {
    throw new Error(`Telefone inválido para envio: "${raw0}" -> "${digits}" (esperado 55 + DDD + 8/9 dígitos)`);
  }

  return { to_chat_id: digits, isGroup: false };
}

// idempotency_key determinístico (fallback) — evita duplicar em chamadas iguais
const stableKey = (obj: any) => {
  const s = JSON.stringify(obj, Object.keys(obj).sort());
  // hash simples (determinístico) sem lib externa
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `auto_${h.toString(16)}`;
};

serve(async (req: Request) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  console.log(`[zapi-send-message] HIT reqId=${reqId} method=${req.method}`);

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  let userId = "system";
  let conversation_id: string | undefined;

  try {
    const authHeader = req.headers.get("Authorization");
    const apiKeyHeader = req.headers.get("apikey");

    // ✅ FIX: Accept BOTH Authorization Bearer AND apikey header for internal function calls
    const isServiceKey =
      authHeader?.trim() === `Bearer ${supabaseServiceKey}` ||
      apiKeyHeader?.trim() === supabaseServiceKey;

    console.log(`[zapi-send-message] reqId=${reqId} auth: hasAuth=${!!authHeader} hasApiKey=${!!apiKeyHeader} isServiceKey=${isServiceKey}`);

    if (!isServiceKey) {
      if (!authHeader) throw new Error("Não autorizado: Sessão ausente");
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) throw new Error("Sessão expirada ou inválida");
      userId = user.id;
    }

    // Sender name
    let senderName = "Atendente G7";
    if (userId !== "system") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("name, display_name")
        .eq("id", userId)
        .maybeSingle();
      if (profile) senderName = profile.display_name || profile.name || "Atendente G7";
    } else {
      senderName = "Ana Mônica";
    }

    const json: Json = await req.json();

    // Inputs
    let { content, chatId, recipient: inputRecipient } = json;
    const {
      message_type,
      media_url,
      sender_name: overrideSenderName,
      is_system = false,    // ✅ NEW: Explicit system flag (default: human)
      takeover = false,     // ✅ NEW: Explicit assignment flag (default: no takeover)
      assign = false        // ✅ NEW: Explicit assignment flag
    } = json;

    conversation_id = json.conversation_id;
    const isGroupInput = toBool(json.isGroup);

    // ✅ FIX: Use explicit is_system instead of userId detection (strict boolean parsing)
    const isSystem = toBool(is_system) || userId === "system";

    console.log(`[zapi-send-message] 📋 Input: conv=${conversation_id} isSystem=${isSystem} content="${(content || '').slice(0, 50)}..."`);

    // idempotency_key - caller should pass trigger-based key, fallback uses content hash
    const idempotency_key: string =
      json.idempotency_key ||
      stableKey({
        conversation_id: conversation_id || null,
        chatId: chatId || inputRecipient || null,
        content: content || "",
        message_type: message_type || "text",
        media_url: media_url || null,
        senderName: overrideSenderName || senderName,
      });

    if (inputRecipient && !chatId) chatId = inputRecipient;
    if (overrideSenderName) senderName = overrideSenderName;

    // Recipient selection
    let recipient = chatId as string | undefined;

    if (conversation_id) {
      const { data: foundConv } = await supabaseAdmin
        .from("conversations")
        .select("id, chat_id, assigned_to, ai_mode, human_control, contacts(phone, is_group)")
        .eq("id", conversation_id)
        .maybeSingle();

      if (!foundConv) {
        return new Response(
          JSON.stringify({ error: "Conversa não localizada no banco", details: { conversation_id } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ✅ FIX DEFINITIVO: SEMPRE usa o chat_id da conversa aberta
      if (!foundConv.chat_id) {
        throw new Error("Conversa sem chat_id. Não é possível enviar.");
      }

      recipient = foundConv.chat_id;

      // Ainda passa phone/is_group do contact para ajudar na normalização (opcional)
      const contact = foundConv.contacts as any;
      if (contact?.phone) {
        // Pode usar para validar ou confirmar, mas recipient JÁ está definido
      }
    }

    if (!recipient) {
      return new Response(
        JSON.stringify({
          error: "O destinatário não possui um identificador válido (chatId ou conversation_id)",
          code: "MISSING_RECIPIENT",
          details: { conversation_id, chatId },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Z-API settings
    const { data: zapiSettings } = await supabaseAdmin
      .from("zapi_settings")
      .select("*")
      .limit(1)
      .single();

    const instanceId = Deno.env.get("ZAPI_INSTANCE_ID") || zapiSettings?.zapi_instance_id;
    const token = Deno.env.get("ZAPI_TOKEN") || zapiSettings?.zapi_token;
    const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN") || zapiSettings?.zapi_security_token;

    if (!instanceId || !token) throw new Error("Configurações de WhatsApp incompletas no servidor");

    // ✅ GATEKEEPER: Normaliza e valida destinatário ANTES de qualquer processamento
    const normalized = normalizeRecipient({
      recipient: String(recipient),
      isGroup: isGroupInput
    });

    const formattedRecipient = normalized.to_chat_id;
    const finalIsGroup = normalized.isGroup;

    // ✅ FIX: dbChatId = JID canônico para o banco (sempre com sufixo @s.whatsapp.net ou @g.us)
    const dbChatId = finalIsGroup
      ? formattedRecipient  // grupos já vêm com @g.us
      : (formattedRecipient.includes('@') ? formattedRecipient : `${formattedRecipient}@s.whatsapp.net`);

    // ✅ VALIDAÇÃO: recipient DEVE ser JID enviável (não aceitar LID interno)
    const isSendableJID = formattedRecipient.includes('@s.whatsapp.net') || formattedRecipient.includes('@g.us');
    const looksLikeBRPhone = /^55\d{10,11}$/.test(formattedRecipient.replace(/\D/g, ''));

    if (!isSendableJID && !looksLikeBRPhone) {
      return new Response(
        JSON.stringify({
          error: "Destinatário inválido: não é um JID enviável",
          code: "INVALID_RECIPIENT_JID",
          details: {
            recipient: formattedRecipient,
            hint: "Recipient deve conter @s.whatsapp.net (pessoa) ou @g.us (grupo), ou ser telefone BR válido (55...)"
          },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const chatKey = getChatKey(formattedRecipient, finalIsGroup);

    // Resolve conversation_id by chatKey if needed
    let finalConvId = conversation_id;
    if (!finalConvId && chatKey) {
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("id, conversations(id)")
        .eq("chat_key", chatKey)
        .maybeSingle();

      if (contact?.conversations?.length) finalConvId = contact.conversations[0].id;
    }

    // Build Z-API request parameters
    let finalContent = content;
    let endpoint = "/send-text";
    const bodyOut: any = { phone: formattedRecipient };

    if (!message_type || message_type === "text") {
      if (userId !== "system") finalContent = `*${senderName}:*\n${content}`;
      bodyOut.message = finalContent;
    } else if (message_type === "image") {
      endpoint = "/send-image";
      bodyOut.image = media_url;
      bodyOut.caption = content ? `*${senderName}:*\n${content}` : "";
    } else if (message_type === "audio") {
      endpoint = "/send-audio";
      bodyOut.audio = media_url;
    } else if (message_type === "document" || message_type === "file") {
      endpoint = "/send-document";
      bodyOut.document = media_url;
      bodyOut.fileName = "documento";
    }

    // ✅ ROBUST CONVERSATION RESOLUTION (App Sync Fix)
    const cleanJid = formattedRecipient.trim().toLowerCase().replace(/^(u:|g:)/i, "");
    // ✅ FIX: Remover duplicate cleanJid
    const candidateKeys = finalIsGroup
      ? [cleanJid, `g:${cleanJid}`]
      : [cleanJid, `u:${cleanJid}`];

    const { data: convRow } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .in("thread_key", candidateKeys)
      .limit(1)
      .maybeSingle();

    const resolvedConversationId = convRow?.id || finalConvId || null;

    // ✅ SYNCHRONOUS OUTBOX IDEMPOTENCY
    const { data: existingOutbox } = await supabaseAdmin
      .from("message_outbox")
      .select("id, sent_at, provider_message_id, status")
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();

    if (existingOutbox) {
      if (existingOutbox.status === "sent") {
        // ✅ RECONCILIATION: Even if deduped, ensure message exists in database
        if (resolvedConversationId && existingOutbox.provider_message_id) {
          const nowIso = new Date().toISOString();
          console.log(`[zapi-send-message] Dedup reconciliation for conv=${resolvedConversationId}`);

          // Upsert to messages (needs unique index on provider_message_id)
          await supabaseAdmin.from("messages").upsert({
            conversation_id: resolvedConversationId,
            sender_type: isSystem ? "assistant" : "agent",
            sender_name: senderName || (isSystem ? "Ana Mônica" : "Atendente G7"),
            sender_id: isSystem ? null : (userId || null),
            agent_id: isSystem ? null : (userId || null),
            agent_name: senderName || (isSystem ? "Ana Mônica" : "Atendente G7"),
            content: content || null,
            message_type: message_type || "text",
            media_url: media_url || null,
            provider: "zapi",
            provider_message_id: existingOutbox.provider_message_id,
            direction: "outbound",
            status: "sent",
            chat_id: dbChatId,
            sent_at: nowIso,
          }, { onConflict: "provider_message_id" });

          // Update conversation preview (without changing AI state if system)
          const updateData: any = {
            last_message: (content || "").trim() ? content.slice(0, 500) : (message_type !== "text" ? `[${message_type}]` : ""),
            last_message_type: message_type || "text",
            last_message_at: nowIso,
            chat_id: dbChatId,
          };

          // Only human messages should disable AI
          if (!isSystem) {
            updateData.human_control = true;
            updateData.ai_mode = "OFF";
            updateData.ai_paused_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          }

          await supabaseAdmin.from("conversations")
            .update(updateData)
            .eq("id", resolvedConversationId);
        }

        return new Response(JSON.stringify({
          success: true,
          deduped: true,
          messageId: existingOutbox.provider_message_id,
          idempotency_key
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log(`[zapi-send-message] Retry detected for idempotency_key=${idempotency_key}, status=${existingOutbox.status}`);
    }

    // Upsert to lock key
    const outboxPayload = {
      endpoint,
      preview: (content || "").slice(0, 120) + (content && content.length > 120 ? "..." : ""),
      media_url: media_url || null,
      message_type: message_type || "text",
    };

    const { data: outboxRow, error: outboxErr } = await supabaseAdmin
      .from("message_outbox")
      .upsert({

        idempotency_key,
        provider: "zapi",
        conversation_id: resolvedConversationId,
        to_chat_id: formattedRecipient,
        recipient: formattedRecipient, // compatibility
        payload: outboxPayload,
        status: "pending",
      }, { onConflict: "idempotency_key" })
      .select("id")
      .maybeSingle();

    if (outboxErr) {
      console.error("[zapi-send-message] Outbox upsert error:", outboxErr.message);
    }

    // Execute send
    const zapiBaseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (clientToken) headers["Client-Token"] = clientToken;

    let result: any;
    let response: Response;

    try {
      response = await fetch(`${zapiBaseUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyOut),
      });
      result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorText = `ZAPI ${response.status}: ${JSON.stringify(result).slice(0, 1000)}`;
        if (outboxRow) {
          await supabaseAdmin.from("message_outbox").update({
            status: "error",
            error: errorText
          }).eq("id", outboxRow.id);
        }
        throw new Error(errorText);
      }
    } catch (fetchErr: any) {
      if (outboxRow) {
        await supabaseAdmin.from("message_outbox").update({
          status: "error",
          error: fetchErr.message
        }).eq("id", outboxRow.id);
      }
      throw fetchErr;
    }

    const providerMessageId = result.messageId || result.statusId || result.zapiMessageId || null;

    // Update outbox success
    if (outboxRow) {
      await supabaseAdmin.from("message_outbox").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: providerMessageId,
        error: null,
      }).eq("id", outboxRow.id);
    }

    // ✅ IMMEDIATE VISIBILITY: Insert into public.messages and update conversation preview
    if (resolvedConversationId) {
      const nowIso = new Date().toISOString();

      // 1) Save to public.messages
      const { error: msgErr } = await supabaseAdmin.from("messages").insert({
        conversation_id: resolvedConversationId,
        // ✅ FIX: Sender fields for UI compatibility
        sender_type: isSystem ? "assistant" : "agent",
        sender_id: isSystem ? null : (userId || null),
        sender_name: senderName || (isSystem ? "Ana Mônica" : "Atendente G7"),
        // Legacy agent fields (mantidos para compatibilidade)
        agent_id: isSystem ? null : (userId || null),
        agent_name: senderName || (isSystem ? "Ana Mônica" : "Atendente G7"),
        content: content || null,
        message_type: message_type || "text",
        media_url: media_url || null,
        provider: "zapi",
        provider_message_id: providerMessageId,
        direction: "outbound",
        status: "sent",
        chat_id: dbChatId,  // ✅ FIX: Usa JID canônico (com @s.whatsapp.net)
        sent_at: nowIso,
      });

      if (msgErr) {
        console.error("[zapi-send-message] Error inserting to messages:", msgErr.message);
      }

      // 2) Update conversation preview
      const updateData: any = {
        last_message: (content || "").trim() ? content.slice(0, 500) : (message_type !== 'text' ? `[${message_type}]` : ""),
        last_message_type: message_type || "text",
        last_message_at: nowIso,
        chat_id: dbChatId,  // ✅ FIX: Usa JID canônico (com @s.whatsapp.net)
      };

      // ✅ FIX: Conditional state updates based on system/assignment
      if (!isSystem) {
        // ✅ FIX: Only pause AI when explicit takeover/assign, not on every message
        const shouldAssign = (toBool(assign) || toBool(takeover)) && userId && userId !== "system";

        if (shouldAssign) {
          // Only pause AI when actually taking over
          updateData.human_control = true;
          updateData.ai_mode = "OFF";
          updateData.ai_paused_until = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // +30min pause

          const { data: convState } = await supabaseAdmin
            .from("conversations")
            .select("assigned_to")
            .eq("id", resolvedConversationId)
            .single();

          // Atribuir apenas se não tiver ninguém (ou se for o próprio usuário reafirmando)
          if (!convState?.assigned_to || convState.assigned_to === userId) {
            updateData.assigned_to = userId;
            updateData.assigned_at = nowIso;
            updateData.assigned_by = userId;
            console.log(`[zapi-send-message] ✅ Assigning conversation to ${userId}`);
          }
        } else {
          console.log(`[zapi-send-message] 👤 Human message without takeover - AI state preserved`);
        }
      } else {
        console.log(`[zapi-send-message] 🤖 System message: preserving AI state`);
        // ✅ System/AI messages NEVER change control state
      }

      const { error: convErr } = await supabaseAdmin
        .from("conversations")
        .update(updateData)
        .eq("id", resolvedConversationId);

      if (convErr) {
        console.error("[zapi-send-message] Error updating conversation:", convErr.message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, messageId: providerMessageId, idempotency_key }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error: any) {
    console.error("[zapi-send-message] Function error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
