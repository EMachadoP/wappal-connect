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

  // se já tem sufixo (@g.us / @lid / @s.whatsapp.net), retorna limpo (sem g:/u:)
  if (clean.includes('@')) return clean;

  return isGrp ? `${clean}@g.us` : `${clean}@s.whatsapp.net`;
};

// idempotency_key determinístico (fallback) — evita duplicar em chamadas iguais
const stableKey = (obj: any) => {
  const s = JSON.stringify(obj, Object.keys(obj).sort());
  // hash simples (determinístico) sem lib externa
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `auto_${h.toString(16)}`;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  let userId = "system";
  let conversation_id: string | undefined;

  try {
    const authHeader = req.headers.get("Authorization");
    const isServiceKey = authHeader?.includes(supabaseServiceKey);

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
    const { message_type, media_url, sender_name: overrideSenderName } = json;

    conversation_id = json.conversation_id;
    const isGroupInput = toBool(json.isGroup);

    // idempotency_key (recomendado sempre mandar)
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
        .select("id, chat_id, thread_key, contact_id, contacts(id, chat_key, chat_lid, lid, phone, is_group)")
        .eq("id", conversation_id)
        .maybeSingle();

      if (!foundConv) {
        return new Response(
          JSON.stringify({ error: "Conversa não localizada no banco", details: { conversation_id } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const contact = foundConv.contacts as any;

      if (!recipient) {
        // ✅ DESTINO DETERMINÍSTICO (LID-first e sem “conv.chat_id” como primeira opção)
        if (contact?.is_group) {
          recipient = contact?.chat_lid || foundConv.chat_id; // chat_lid do grupo deve ser @g.us
        } else {
          // Prioriza @lid (estável pra thread do WhatsApp Business)
          const lid =
            (contact?.chat_lid && String(contact.chat_lid).endsWith("@lid"))
              ? contact.chat_lid
              : (contact?.lid && String(contact.lid).endsWith("@lid"))
                ? contact.lid
                : null;

          recipient = lid || contact?.phone || contact?.chat_lid || contact?.lid || foundConv.chat_id;
        }
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

    // ✅ PATCH: Robust Group Inference & Prefix Stripping
    const inferIsGroup = (id: string) => {
      const x = stripPrefix((id || '').trim().toLowerCase());
      return x.endsWith('@g.us') || /^\d{10,14}-\d+$/.test(x.replace(/@g\.us$/, ''));
    };

    const cleanRecipient = stripPrefix(String(recipient));
    const finalIsGroup = typeof isGroupInput === 'boolean' ? isGroupInput : inferIsGroup(cleanRecipient);

    const formattedRecipient = formatForZAPI(cleanRecipient, finalIsGroup);
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

    // ✅ OUTBOX IDEMPOTENTE (se já existe, não envia novamente)
    const outboxPayload = {
      to: formattedRecipient,
      isGroup: finalIsGroup,
      message_type: message_type || "text",
      content: content || "",
      media_url: media_url || null,
      senderName,
      conversation_id: finalConvId || null,
    };

    const { data: outboxRow, error: outboxErr } = await supabaseAdmin
      .from("message_outbox")
      .insert({
        provider: "zapi",
        idempotency_key,
        conversation_id: finalConvId || null,
        to_chat_id: formattedRecipient,
        payload: outboxPayload,
      })
      .select("id, sent_at, provider_message_id")
      .maybeSingle();

    if (outboxErr?.code === "23505") {
      // já enviado com essa chave
      return new Response(
        JSON.stringify({ success: true, duplicated: true, idempotency_key }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (outboxErr) throw new Error(`Outbox error: ${outboxErr.message}`);
    // If we didn't get a row back, it might be due to race condition or conflict handled by maybeSingle
    if (!outboxRow) {
      return new Response(
        JSON.stringify({ success: true, duplicated: true, idempotency_key }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build request
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

    const zapiBaseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (clientToken) headers["Client-Token"] = clientToken;

    const response = await fetch(`${zapiBaseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyOut),
    });

    const result = await response.json();
    if (!response.ok) {
      await supabaseAdmin.from("message_outbox").update({
        error: `ZAPI ${response.status}: ${JSON.stringify(result)}`,
      }).eq("id", outboxRow.id);
      throw new Error(`Falha Z-API (${response.status}): ${JSON.stringify(result)}`);
    }

    const providerMessageId = result.messageId || result.statusId || result.zapiMessageId || null;

    // Save message
    await supabaseAdmin.from("messages").insert({
      conversation_id: finalConvId,
      sender_type: "agent",
      sender_id: userId === "system" ? null : userId,
      agent_name: senderName,
      content: content,
      message_type: message_type || "text",
      media_url,
      sent_at: new Date().toISOString(),
      provider: "zapi",
      provider_message_id: providerMessageId,
      status: "sent",
      direction: "outbound",
      chat_id: formattedRecipient,
    });

    await supabaseAdmin.from("message_outbox").update({
      sent_at: new Date().toISOString(),
      provider_message_id: providerMessageId,
    }).eq("id", outboxRow.id);

    // Update conversation
    if (finalConvId) {
      if (userId !== "system") {
        const pauseUntil = new Date(Date.now() + 30 * 60 * 1000);
        await supabaseAdmin.from("conversations").update({
          human_control: true,
          ai_mode: "OFF",
          ai_paused_until: pauseUntil.toISOString(),
          last_message_at: new Date().toISOString(),
        }).eq("id", finalConvId);
      } else {
        await supabaseAdmin.from("conversations").update({
          last_message_at: new Date().toISOString(),
        }).eq("id", finalConvId);
      }
    }

    return new Response(
      JSON.stringify({ success: true, messageId: providerMessageId, idempotency_key }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
