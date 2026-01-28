import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isEmployeeSender } from "../_shared/is-employee.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// -------------------------
// Small utilities
// -------------------------
function stableHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickDeterministic(seed: string, arr: string[]) {
  if (!arr.length) return "";
  const h = stableHash(seed);
  return arr[h % arr.length];
}

function nowMinuteBucket() {
  return Math.floor(Date.now() / 60000); // changes every minute
}

function normalizeText(t: string) {
  return (t || "").trim();
}

function isJustConfirmation(text: string): boolean {
  const normalized = (text || "")
    .trim()
    .toLowerCase()
    .replace(/[!.?,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const CONFIRMATIONS = new Set([
    "ok", "okay", "oks", "okk", "okok",
    "sim", "sims", "ss", "sss",
    "nao", "não", "n",
    "blz", "beleza", "bele",
    "certo", "certinho", "ctz",
    "entendi", "entendido",
    "combinado", "fechado",
    "valeu", "vlw", "vlww",
    "obrigado", "obrigada", "obg", "brigado", "brigada",
    "ta", "tá", "ta bom", "tá bom", "tudo bem",
    "perfeito", "otimo", "ótimo",
    "show", "top", "massa",
    "pode ser", "bora", "vamos",
    "legal", "tranquilo", "tranquila",
    "boa tarde", "bom dia", "boa noite",
    "ate mais", "até mais", "ate logo", "até logo",
    "tchau", "flw", "falou", "abraco", "abraço",
  ]);

  if (CONFIRMATIONS.has(normalized)) return true;
  if (normalized.length < 5) return true;
  if (/^(ok+|sim+|ss+|n[aã]o+|blz+|vlw+|obg|ta\s*bom)$/i.test(normalized)) return true;

  return false;
}

function isOperationalIssue(text: string) {
  return /(câmera|camera|cftv|dvr|gravador|nvr|port[aã]o|motor|cerca|interfone|controle de acesso|catraca|fechadura|tv coletiva|antena|acesso remoto|sem imagem|sem sinal|travado|n[aã]o abre|n[aã]o fecha|parou|quebrado|defeito)/i.test(text);
}

function getLastByRole(msgs: { role: string; content: string }[], role: string) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === role) return msgs[i];
  }
  return null;
}

function isGenericContactName(name?: string | null) {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return true;
  const generic = [
    "portaria", "recepcao", "recepção", "guarita", "porteiro", "zelador", "zeladoria",
    "administracao", "administração", "sindico", "síndico", "condominio", "condomínio",
    "predio", "prédio", "edificio", "edifício",
  ];
  if (/^\d+$/.test(n)) return true;
  if (n.length <= 3) return true;
  return generic.some((k) => n.includes(k));
}

async function hasRecentProtocol(supabase: any, conversationId: string, withinMinutes = 60): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("protocols")
    .select("id")
    .eq("conversation_id", conversationId)
    .gte("created_at", cutoff)
    .limit(1);

  if (error) return false;
  return (data?.length || 0) > 0;
}

// -------------------------
// Lock (table ai_conversation_locks)
// -------------------------
async function acquireLock(supabase: any, conversationId: string) {
  try {
    const now = new Date().toISOString();

    // cleanup expired (best effort)
    await supabase.from("ai_conversation_locks").delete().lt("locked_until", now);

    const lockedUntil = new Date(Date.now() + 20 * 1000).toISOString();
    const { error } = await supabase.from("ai_conversation_locks").insert({
      conversation_id: conversationId,
      locked_until: lockedUntil,
      lock_owner: "ai-generate-reply",
    });

    // unique violation = busy
    if (error?.code === "23505") return false;

    // if table missing, proceed (resilient)
    if (error?.message?.includes("ai_conversation_locks")) return true;

    if (error) throw error;
    return true;
  } catch (_e) {
    // resilience: do not block replies if lock infra fails
    return true;
  }
}

// -------------------------
// Hydration: if few messages came in payload, load from DB
// -------------------------
async function hydrateMessagesFromDbIfNeeded(
  supabase: any,
  conversationId: string | undefined,
  incoming: { role: string; content: string }[],
  minIncoming = 10,
  takeLast = 40,
) {
  if (!conversationId) return incoming || [];
  if ((incoming?.length || 0) >= minIncoming) return incoming || [];

  // 1) Busca inbound/outbound do "messages"
  const { data: rowsM, error: errM } = await supabase
    .from("messages")
    .select("content, transcript, direction, sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .limit(takeLast);

  // 2) Busca respostas enviadas da IA (outbox)
  const { data: rowsO, error: errO } = await supabase
    .from("message_outbox")
    .select("content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(takeLast);

  const dbMsgs: { role: string; content: string; ts: string }[] = [];

  if (!errM && rowsM?.length) {
    for (const r of rowsM) {
      const txt = (r.transcript ?? r.content ?? "").trim();
      if (!txt) continue;
      const role = r.direction === "inbound" ? "user" : "assistant";
      dbMsgs.push({ role, content: txt, ts: r.sent_at });
    }
  }

  if (!errO && rowsO?.length) {
    for (const r of rowsO) {
      const txt = (r.content ?? "").trim();
      if (!txt) continue;
      // outbox é sempre "assistant"
      dbMsgs.push({ role: "assistant", content: txt, ts: r.created_at });
    }
  }

  if (!dbMsgs.length) return incoming || [];

  // Ordena cronologicamente (muito importante!)
  dbMsgs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // Converte para o formato do modelo
  const normalized = dbMsgs.map(m => ({ role: m.role, content: m.content }));

  // Merge + dedup leve
  const merged = [...normalized, ...(incoming || [])].filter(m => m.role !== "system");

  const seen = new Set<string>();
  const deduped: { role: string; content: string }[] = [];
  for (const m of merged) {
    const c = (m.content || "").trim();
    if (!c) continue;

    // 🔒 Não dedupa mensagens muito curtas (evita sumir "Sim", "Ok", "1901")
    if (c.length <= 6) {
      deduped.push({ role: m.role, content: c });
      continue;
    }

    const k = `${m.role}::${c}`.slice(0, 600);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push({ role: m.role, content: c });
  }

  return deduped.slice(-60);
}

// -------------------------
// Protocol helpers
// -------------------------
async function getOpenProtocol(supabase: any, conversationId: string) {
  const { data } = await supabase
    .from("protocols")
    .select("id, protocol_code, status, created_at")
    .eq("conversation_id", conversationId)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1);

  return data?.[0] ?? null;
}

// -------------------------
// Gemini call (REST generateContent)
// -------------------------
async function callGeminiText({
  apiKey,
  model,
  systemInstruction,
  history,
  temperature = 0.4,
}: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  history: { role: string; content: string }[];
  temperature?: number;
}) {
  // Map to Gemini "contents"
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 512,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini error (${resp.status}): ${txt}`);
  }

  const json = await resp.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("") ??
    "";

  return String(text || "").trim();
}

// -------------------------
// Protocol creation (keeps your current behavior: supports condominium_id OR raw name)
// -------------------------
async function executeCreateProtocol(
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string,
  conversationId: string,
  participantId: string | undefined,
  args: any,
) {
  if (!conversationId) throw new Error("conversation_id is required");

  // fetch conversation pending_payload + active_condominium_id
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, active_condominium_id, pending_payload, contacts(name)")
    .eq("id", conversationId)
    .single();

  if (convErr) throw new Error(`Failed to fetch conversation: ${convErr.message}`);

  const pendingPayload = (conv?.pending_payload ?? {}) as any;
  const condominiumRawName =
    pendingPayload.condo_raw_name ||
    pendingPayload.condo_raw ||
    pendingPayload.condominium_name ||
    pendingPayload.condominium_raw_name ||
    null;

  let condominiumId = conv?.active_condominium_id || null;

  // fallback: conversation_participants -> entity_id (if exists)
  if (!condominiumId) {
    const { data: part } = await supabase
      .from("conversation_participants")
      .select("entity_id")
      .eq("conversation_id", conversationId)
      .not("entity_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (part?.entity_id) condominiumId = part.entity_id;
  }

  if (!condominiumId && !condominiumRawName) {
    // store raw if provided in args
    const rawName = (args?.condominium_name || args?.condominium_raw || "").toString().trim();
    if (rawName) {
      pendingPayload.condo_raw_name = rawName;
      await supabase.from("conversations").update({ pending_payload: pendingPayload }).eq("id", conversationId);
    }
  }

  const bodyObj = {
    conversation_id: conversationId,
    condominium_id: condominiumId,
    condominium_name: condominiumRawName || (args?.condominium_name || args?.condominium_raw || null),
    participant_id: participantId,
    summary: args.summary,
    priority: args.priority || "normal",
    category: args.category || "operational",
    requester_name: args.requester_name || (conv?.contacts as any)?.name || "Não informado",
    requester_role: args.requester_role || "Morador",
    apartment: args.apartment || null,
    notify_group: true,  // WhatsApp + Asana
    notify_client: false // AI answers the user
  };

  const response = await fetch(`${supabaseUrl}/functions/v1/create-protocol`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
      apikey: supabaseServiceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyObj),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Create protocol failed (${response.status}): ${errorText}`);
  }

  return await response.json();
}

function isInternalOpsText(text: string) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("criar agendamento:") ||
    t.includes("operador (celular)") ||
    t.includes("para eu abrir o chamado") ||
    t.includes("me envie assim:") ||
    t.includes("exemplo:")
  );
}

// -------------------------
// Prompt: rules anti-erro + extraction block
// -------------------------
function buildSystemInstruction(params: {
  identifiedName?: string | null;
  identifiedCondo?: string | null;
  identifiedRole?: string | null;
}) {
  const { identifiedName, identifiedCondo, identifiedRole } = params;

  const identifiedBlock =
    identifiedName || identifiedCondo || identifiedRole
      ? [
        "CONTATO IDENTIFICADO (cadastro 100% confiável):",
        identifiedName ? `- Nome: ${identifiedName}` : null,
        identifiedCondo ? `- Condomínio: ${identifiedCondo}` : null,
        identifiedRole ? `- Função: ${identifiedRole}` : null,
      ].filter(Boolean).join("\n")
      : "CONTATO NÃO IDENTIFICADO (não repetir nomes/condomínios do texto do cliente).";

  return [
    "Você é Ana Mônica, atendente virtual da G7 Serv.",
    "",
    identifiedBlock,
    "",
    "REGRAS CRÍTICAS (OBRIGATÓRIO):",
    identifiedName ? `1) Nome confirmado no cadastro: ${identifiedName}. Use exatamente esse nome. Nunca use username/handle.` : "1) Se o contato NÃO estiver identificado, NÃO repita nome/condomínio (evite errar e irritar o cliente).",
    "2) Se o contato estiver identificado, você PODE usar APENAS os dados do cadastro.",
    "3) Seja natural, objetiva e educada. Evite soar robótica. Não invente informações.",
    "4) Faça no máximo 1 pergunta por resposta (somente o essencial).",
    "5) Use sempre o contexto (pelo menos as 20 últimas mensagens).",
    "6) Não pergunte se o equipamento/portão é da G7. Assuma que é atendimento G7.",
    "",
    "SE já houver informações suficientes para abrir protocolo, inclua ao FINAL um bloco:",
    "###PROTOCOLO###",
    "{\"criar\": true/false, \"condominio_raw\": \"...\", \"problema\": \"...\", \"categoria\": \"operational|financial|commercial|admin|support\", \"prioridade\": \"normal|critical\", \"solicitante_raw\": \"...\"}",
    "###FIM###",
    "",
    "IMPORTANTE: Em condominio_raw e solicitante_raw use exatamente como o cliente escreveu (sem corrigir).",
  ].join("\n");
}

function extractProtocolBlock(text: string) {
  const m = text.match(/###PROTOCOLO###\s*([\s\S]*?)\s*###FIM###/i);
  if (!m) return { cleanText: text.trim(), protocol: null as any };

  const jsonRaw = m[1].trim();
  let parsed: any = null;
  try {
    parsed = JSON.parse(jsonRaw);
  } catch (_e) {
    parsed = null;
  }

  const cleanText = text.replace(m[0], "").trim();
  return { cleanText, protocol: parsed };
}

// -------------------------
// Main handler
// -------------------------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let conversationId: string | undefined;

  try {
    const rawBody = await req.json();

    conversationId = rawBody.conversation_id || rawBody.conversationId || rawBody.conversation?.id;
    const participant_id = rawBody.participant_id;
    const dryRun = Boolean(rawBody.dry_run); // helpful: test without sending/protocol

    if (conversationId) {
      const locked = await acquireLock(supabase, conversationId);
      if (!locked) {
        return new Response(JSON.stringify({ text: null, skipped: "lock_busy" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // messages from payload + hydrate if needed
    const incoming = (rawBody.messages || []).filter((m: any) => m?.role && m?.content);
    let messages = await hydrateMessagesFromDbIfNeeded(supabase, conversationId, incoming);

    // always analyze at least last 20 when available
    const HISTORY_N = messages.length >= 20 ? 20 : Math.max(10, messages.length);
    const last20 = messages.slice(-HISTORY_N);
    const lastUser = getLastByRole(messages, "user");
    const lastUserText = normalizeText(lastUser?.content || "");

    // guard: load conversation mode flags
    if (conversationId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("ai_mode, human_control, ai_paused_until, last_human_message_at")
        .eq("id", conversationId)
        .maybeSingle();

      if (conv) {
        const aiMode = String(conv.ai_mode || "").toUpperCase();
        const isPaused = conv.ai_paused_until && new Date(conv.ai_paused_until) > new Date();

        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const lastHumanMsgAt = conv.last_human_message_at ? new Date(conv.last_human_message_at) : null;
        const remainsControlled = conv.human_control === true && (!lastHumanMsgAt || lastHumanMsgAt > thirtyMinutesAgo);

        if (aiMode === "OFF" || remainsControlled || isPaused) {
          return new Response(JSON.stringify({ text: null, skipped: "ai_disabled" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // employee detection (kept minimal)
    if (conversationId) {
      const { data: lastMsg } = await supabase
        .from("messages")
        .select("raw_payload, sender_type, direction, content, transcript")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const rawPayload = lastMsg?.raw_payload ?? {};
      const employee = await isEmployeeSender(supabase, rawPayload);
      const isEmployee = employee?.isEmployee === true;

      const lastIsFromAgent =
        (lastMsg?.direction === "outbound") ||
        (String(lastMsg?.sender_type || "").toLowerCase() === "agent");

      // if employee is sending, do not auto-answer unless you explicitly want it
      if (isEmployee && lastIsFromAgent) {
        return new Response(JSON.stringify({ text: null, skipped: "employee_sender" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // confirmation handling (deterministic variations)
    if (conversationId && isJustConfirmation(lastUserText)) {
      const recent = await hasRecentProtocol(supabase, conversationId, 60);
      if (recent) {
        const replies = ["👍", "Combinado!", "Perfeito!", "Certo, qualquer coisa me avise.", "Disponha!"];
        const seed = `${conversationId}:${nowMinuteBucket()}`;
        const msg = pickDeterministic(seed, replies);
        return new Response(JSON.stringify({ text: msg, finish_reason: "CONFIRMATION" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // if no recent protocol, just be neutral (still avoid repeating names)
      const replies = ["Perfeito. Me diga como posso ajudar por aqui.", "Certo! Me diga o que você precisa.", "Entendido. Em que posso ajudar?"];
      const msg = pickDeterministic(`${conversationId}:${nowMinuteBucket()}`, replies);
      return new Response(JSON.stringify({ text: msg, finish_reason: "CONFIRMATION_NO_PROTOCOL" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // load reliable contact/condo data (ONLY for identified)
    let identifiedName: string | null = null;
    let identifiedCondo: string | null = null;
    let identifiedRole: string | null = null;

    if (conversationId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("contact_id, active_condominium_id, contacts(name), condominiums(name)")
        .eq("id", conversationId)
        .maybeSingle();

      const contactName = (conv?.contacts as any)?.name ?? null;
      if (contactName && !isGenericContactName(contactName)) identifiedName = contactName;

      identifiedCondo = (conv?.condominiums as any)?.name ?? null;

      if (conv?.contact_id) {
        const { data: part } = await supabase
          .from("participants")
          .select("role_type")
          .eq("contact_id", conv.contact_id)
          .eq("is_primary", true)
          .maybeSingle();
        if (part?.role_type) identifiedRole = String(part.role_type);
      }
    }

    const systemInstruction = buildSystemInstruction({ identifiedName, identifiedCondo, identifiedRole });

    // choose model/key
    const geminiKey =
      Deno.env.get("GEMINI_API_KEY") ||
      Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY") ||
      Deno.env.get("GOOGLE_API_KEY") ||
      "";
    const geminiModel = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

    if (!geminiKey) {
      // fail safe: deterministic fallback without hallucinating names
      const fallback = pickDeterministic(
        `${conversationId || "noid"}:${nowMinuteBucket()}`,
        [
          "Entendido! Vou encaminhar para a equipe e já retorno por aqui.",
          "Certo — vou repassar para o time responsável e sigo te atualizando por aqui.",
          "Perfeito. Já estou encaminhando internamente e volto com um posicionamento.",
        ],
      );

      return new Response(JSON.stringify({ text: fallback, finish_reason: "NO_LLM_KEY" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The model gets at least last 20 messages for context
    const historyForModel = last20.length ? last20 : messages.slice(-20);

    if (dryRun) {
      return new Response(JSON.stringify({
        dry_run: true,
        systemInstruction,
        history: historyForModel,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let llmText = await callGeminiText({
      apiKey: geminiKey,
      model: geminiModel,
      systemInstruction,
      history: historyForModel,
      temperature: 0.4,
    });

    let { cleanText, protocol } = extractProtocolBlock(llmText);

    // ✅ Filtro de segurança contra vazamento de instruções internas
    if (isInternalOpsText(cleanText)) {
      console.log("[safety] Blocked internal ops leak in cleanText");
      cleanText = "Entendido! Vou encaminhar internamente e já retorno por aqui.";
    }
    if (isInternalOpsText(llmText)) {
      console.log("[safety] Blocked internal ops leak in llmText");
      llmText = "Entendido! Vou encaminhar internamente e já retorno por aqui.";
    }

    // If protocol requested, create it (raw fields kept as user wrote)
    if (conversationId && protocol?.criar === true) {
      const existing = await getOpenProtocol(supabase, conversationId);

      let created: any = null;
      let protocolCode = "";

      if (existing) {
        console.log("[AI] Usando protocolo existente (idempotência):", existing.protocol_code);
        protocolCode = existing.protocol_code;
      } else {
        const summary = String(protocol?.problema || "").trim() || lastUserText.slice(0, 500);
        const condRaw = String(protocol?.condominio_raw || "").trim();
        const requesterRaw = String(protocol?.solicitante_raw || "").trim();

        // store raw in pending_payload so create-protocol can pass condominium_name
        if (condRaw) {
          const { data: cur } = await supabase.from("conversations").select("pending_payload").eq("id", conversationId).maybeSingle();
          const pp = (cur?.pending_payload ?? {}) as any;
          pp.condo_raw_name = condRaw;
          await supabase.from("conversations").update({ pending_payload: pp }).eq("id", conversationId);
        }

        created = await executeCreateProtocol(
          supabase,
          supabaseUrl,
          supabaseServiceKey,
          conversationId,
          participant_id,
          {
            summary: summary.slice(0, 500),
            category: protocol?.categoria || "operational",
            priority: protocol?.prioridade || "normal",
            requester_name: requesterRaw || undefined,
            condominium_name: condRaw || undefined,
          },
        );
        protocolCode = created?.protocol?.protocol_code || created?.protocol_code || created?.protocol?.code || "";
      }

      const code = protocolCode ? (String(protocolCode).startsWith("G7-") ? protocolCode : `G7-${protocolCode}`) : "registrado";

      // deterministic variation message (no condo/name repetition if not identified)
      const confirms = [
        `Certo. Chamado registrado sob o protocolo ${code}. Já encaminhei para a equipe e seguimos por aqui.`,
        `Perfeito — protocolei como ${code}. Já direcionei para o time responsável e vou te atualizando.`,
        `Entendido. Protocolo ${code} registrado e encaminhado. Se tiver algum detalhe adicional, me avise por aqui.`,
      ];

      const msg = pickDeterministic(`${conversationId}:${code}`, confirms);
      const finalText = cleanText ? `${cleanText}\n\n${msg}` : msg;

      return new Response(JSON.stringify({
        text: finalText,
        finish_reason: "PROTOCOL_CREATED",
        provider: "gemini",
        model: geminiModel,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Normal reply (keep it, but do not force greetings)
    return new Response(JSON.stringify({
      text: cleanText || llmText || null,
      finish_reason: "LLM_REPLY",
      provider: "gemini",
      model: geminiModel,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const safe = pickDeterministic(
      `${conversationId || "noid"}:${nowMinuteBucket()}`,
      [
        "Entendido! Vou verificar por aqui e já retorno.",
        "Certo — vou checar isso agora e te dou um retorno por aqui.",
        "Perfeito. Já estou verificando e volto com uma atualização.",
      ],
    );

    return new Response(JSON.stringify({
      text: safe,
      error: String(e?.message || e),
      finish_reason: "ERROR_FALLBACK",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
