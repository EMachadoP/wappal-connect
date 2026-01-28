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
  return Math.floor(Date.now() / 60000);
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
    "oi", "oie", "ola", "olá",
    "ate mais", "até mais", "ate logo", "até logo",
    "tchau", "flw", "falou", "abraco", "abraço",
  ]);

  if (CONFIRMATIONS.has(normalized)) return true;
  if (normalized.length < 5) return true;
  if (/^(ok+|sim+|ss+|n[aã]o+|blz+|vlw+|obg|ta\s*bom)$/i.test(normalized)) return true;

  return false;
}

function getGreeting(text: string): string | null {
  const t = (text || "").toLowerCase();
  if (t.includes("bom dia")) return "Bom dia";
  if (t.includes("boa tarde")) return "Boa tarde";
  if (t.includes("boa noite")) return "Boa noite";
  if (t.includes("ola") || t.includes("olá") || t.includes("oi")) return "Olá";
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
    await supabase.from("ai_conversation_locks").delete().lt("locked_until", now);

    const lockedUntil = new Date(Date.now() + 20 * 1000).toISOString();
    const { error } = await supabase.from("ai_conversation_locks").insert({
      conversation_id: conversationId,
      locked_until: lockedUntil,
      lock_owner: "ai-generate-reply",
    });

    if (error?.code === "23505") return false;
    if (error?.message?.includes("ai_conversation_locks")) return true;
    if (error) throw error;
    return true;
  } catch (_e) {
    return true;
  }
}

// -------------------------
// Hydration: load messages from DB
// -------------------------
async function hydrateMessagesFromDb(
  supabase: any,
  conversationId: string,
  takeLast = 20,
) {
  if (!conversationId) return [];

  const { data: rowsM } = await supabase
    .from("messages")
    .select("content, transcript, direction, sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .limit(takeLast);

  const { data: rowsO } = await supabase
    .from("message_outbox")
    .select("content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(takeLast);

  const dbMsgs: { role: string; content: string; ts: string }[] = [];

  if (rowsM?.length) {
    for (const r of rowsM) {
      const txt = (r.transcript ?? r.content ?? "").trim();
      if (!txt) continue;
      const role = r.direction === "inbound" ? "user" : "assistant";
      dbMsgs.push({ role, content: txt, ts: r.sent_at });
    }
  }

  if (rowsO?.length) {
    for (const r of rowsO) {
      const txt = (r.content ?? "").trim();
      if (!txt) continue;
      dbMsgs.push({ role: "assistant", content: txt, ts: r.created_at });
    }
  }

  dbMsgs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const seen = new Set<string>();
  const deduped: { role: string; content: string }[] = [];

  for (const m of dbMsgs) {
    const c = m.content.trim();
    if (!c) continue;
    if (c.length <= 6) {
      deduped.push({ role: m.role, content: c });
      continue;
    }
    const k = `${m.role}::${c}`.slice(0, 600);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push({ role: m.role, content: c });
  }

  return deduped.slice(-20);
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
// Gemini call
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
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("") ?? "";

  return String(text || "").trim();
}

// -------------------------
// Protocol creation
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

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, active_condominium_id, pending_payload, contacts(name)")
    .eq("id", conversationId)
    .single();

  const pendingPayload = (conv?.pending_payload ?? {}) as any;
  const condominiumRawName =
    pendingPayload.condo_raw_name ||
    args?.condominium_name ||
    args?.condominium_raw ||
    null;

  let condominiumId = conv?.active_condominium_id || null;

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

  const bodyObj = {
    conversation_id: conversationId,
    condominium_id: condominiumId,
    condominium_name: condominiumRawName,
    participant_id: participantId,
    summary: args.summary,
    priority: args.priority || "normal",
    category: args.category || "operational",
    requester_name: args.requester_name || (conv?.contacts as any)?.name || "Não informado",
    requester_role: args.requester_role || "Morador",
    apartment: args.apartment || null,
    notify_group: true,
    notify_client: false
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

// -------------------------
// System Prompt - REGRAS CRÍTICAS
// -------------------------
function buildSystemInstruction(params: {
  identifiedName?: string | null;
  identifiedCondo?: string | null;
  identifiedRole?: string | null;
  hasOpenProtocol?: boolean;
}) {
  const { identifiedName, identifiedCondo, identifiedRole, hasOpenProtocol } = params;

  const identifiedBlock =
    identifiedName || identifiedCondo || identifiedRole
      ? [
        "=== CONTATO IDENTIFICADO (cadastro 100% confiável) ===",
        identifiedName ? `- Nome: ${identifiedName}` : null,
        identifiedCondo ? `- Condomínio: ${identifiedCondo}` : null,
        identifiedRole ? `- Função: ${identifiedRole}` : null,
        "",
        "👉 USE esses dados nas respostas. Pode chamar pelo nome cadastrado.",
      ].filter(Boolean).join("\n")
      : [
        "=== CONTATO NÃO IDENTIFICADO ===",
        "👉 NÃO repita nomes ou condomínios que o cliente mencionar.",
        "👉 Se o cliente disser 'Sou Maria do Julio II', NÃO responda 'Oi Maria!' ou 'Entendi, Julio II'.",
        "👉 Responda de forma NEUTRA: 'Entendido!', 'Certo!', 'Vou verificar'.",
        "👉 Isso evita erros de interpretação que irritam o cliente.",
      ].join("\n");

  const protocolStatus = hasOpenProtocol
    ? "⚠️ JÁ EXISTE PROTOCOLO ABERTO. NÃO crie outro para o mesmo assunto."
    : "Não há protocolo aberto recentemente.";

  return [
    "Você é Ana Mônica, atendente virtual da G7 Serv (segurança eletrônica e portaria remota).",
    "",
    identifiedBlock,
    "",
    protocolStatus,
    "",
    "=== REGRAS CRÍTICAS (OBRIGATÓRIO) ===",
    "",
    "1. SAUDAÇÕES:",
    "   - NÃO comece TODA resposta com 'Olá!' - varie ou omita",
    "   - Se o cliente disse 'Boa tarde', responda 'Boa tarde!' (não 'Olá!')",
    "",
    "2. DADOS DO CLIENTE:",
    "   - Se IDENTIFICADO: use APENAS os dados do cadastro (nome, condomínio)",
    "   - Se NÃO IDENTIFICADO: seja NEUTRO, não repita o que o cliente disse",
    "",
    "3. QUALIFICAÇÃO (MUITO IMPORTANTE):",
    "   - ANTES de abrir protocolo, você DEVE qualificar o problema",
    "   - Se a descrição for genérica (ex: 'problema no interfone'), PERGUNTE detalhes",
    "   - Exemplos de perguntas:",
    "     * 'O interfone está mudo, não toca, ou não abre o portão?'",
    "     * 'O portão não abre, não fecha, ou está fazendo barulho?'",
    "     * 'Qual câmera está com problema e o que aparece na tela?'",
    "   - Só abra protocolo quando tiver descrição ESPECÍFICA do sintoma",
    "",
    "4. PERGUNTAS:",
    "   - Faça no MÁXIMO 1 pergunta por resposta",
    "   - Seja objetiva e direta",
    "",
    "5. PROTOCOLO:",
    "   - Quando tiver informações SUFICIENTES (problema detalhado + condomínio), inclua:",
    "   ###PROTOCOLO###",
    '   {"criar": true, "condominio_raw": "...", "problema": "descrição detalhada", "categoria": "operational", "prioridade": "normal"}',
    "   ###FIM###",
    "   - Em condominio_raw use EXATAMENTE como o cliente escreveu",
    "   - NÃO mencione 'protocolo criado' no texto da resposta - o sistema cuida disso",
    "",
    "6. RESPOSTAS:",
    "   - Seja natural, educada e objetiva",
    "   - Não invente informações",
    "   - Não mencione termos internos (protocolo, prioridade, categoria)",
  ].join("\n");
}

function extractProtocolBlock(text: string) {
  const m = text.match(/###PROTOCOLO###\s*([\s\S]*?)\s*###FIM###/i);
  if (!m) return { cleanText: text.trim(), protocol: null as any };

  let payload = (m[1] ?? "").trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed: any = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    const obj = payload.match(/\{[\s\S]*\}/);
    if (obj) {
      try { parsed = JSON.parse(obj[0]); } catch { parsed = null; }
    }
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

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "conversation_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lock
    const locked = await acquireLock(supabase, conversationId);
    if (!locked) {
      return new Response(JSON.stringify({ text: null, skipped: "lock_busy" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load messages (sempre do banco, últimas 20)
    const messages = await hydrateMessagesFromDb(supabase, conversationId, 20);

    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    const lastUserText = normalizeText(lastUserMsg?.content || "");

    // Check AI mode
    const { data: conv } = await supabase
      .from("conversations")
      .select("ai_mode, human_control, ai_paused_until, last_human_message_at, contact_id, active_condominium_id, contacts(name), condominiums(name)")
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

    // Employee detection
    const { data: lastMsg } = await supabase
      .from("messages")
      .select("raw_payload, sender_type, direction")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const employee = await isEmployeeSender(supabase, lastMsg?.raw_payload ?? {});
    const lastIsFromAgent = lastMsg?.direction === "outbound" || lastMsg?.sender_type === "agent";

    if (employee?.isEmployee && lastIsFromAgent) {
      return new Response(JSON.stringify({ text: null, skipped: "employee_sender" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirmation handling
    if (isJustConfirmation(lastUserText)) {
      const greetingFound = getGreeting(lastUserText);
      const recent = await hasRecentProtocol(supabase, conversationId, 60);

      if (recent) {
        const replies = ["👍", "Combinado!", "Perfeito!", "Certo!", "Disponha!"];
        const msg = pickDeterministic(`${conversationId}:${nowMinuteBucket()}`, replies);
        return new Response(JSON.stringify({ text: msg, finish_reason: "CONFIRMATION" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (greetingFound) {
        return new Response(JSON.stringify({ text: `${greetingFound}! Em que posso ajudar?`, finish_reason: "GREETING" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const replies = ["Certo! Me diga como posso ajudar.", "Entendido. Em que posso ajudar?", "Perfeito! O que você precisa?"];
      const msg = pickDeterministic(`${conversationId}:${nowMinuteBucket()}`, replies);
      return new Response(JSON.stringify({ text: msg, finish_reason: "CONFIRMATION_NO_PROTOCOL" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load identified data
    let identifiedName: string | null = null;
    let identifiedCondo: string | null = null;
    let identifiedRole: string | null = null;

    const contactName = (conv?.contacts as any)?.name ?? null;
    if (contactName && !isGenericContactName(contactName)) {
      identifiedName = contactName;
    }

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

    const existingProtocol = await getOpenProtocol(supabase, conversationId);

    const systemInstruction = buildSystemInstruction({
      identifiedName,
      identifiedCondo,
      identifiedRole,
      hasOpenProtocol: !!existingProtocol
    });

    // Call Gemini
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "";
    const geminiModel = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";

    if (!geminiKey) {
      const fallback = pickDeterministic(`${conversationId}:${nowMinuteBucket()}`, [
        "Entendido! Vou verificar e já retorno.",
        "Certo — vou checar isso e volto com uma resposta.",
      ]);
      return new Response(JSON.stringify({ text: fallback, finish_reason: "NO_LLM_KEY" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const llmText = await callGeminiText({
      apiKey: geminiKey,
      model: geminiModel,
      systemInstruction,
      history: messages,
      temperature: 0.4,
    });

    let { cleanText, protocol } = extractProtocolBlock(llmText);
    let userText = cleanText;

    // ✅ FILTRO DE QUALIFICAÇÃO - Bloquear problemas genéricos
    if (protocol?.criar === true) {
      const prob = String(protocol?.problema || "").toLowerCase().trim();

      const GENERIC_PATTERNS = [
        /^problema\s*(no|na|com|de)?\s*(interfone|portão|portao|câmera|camera|cftv|cerca)?$/i,
        /^defeito\s*(no|na|com|de)?/i,
        /^não\s*(está\s*)?funciona(ndo)?$/i,
        /^parou(\s*de\s*funcionar)?$/i,
        /^com\s*problema$/i,
      ];

      const isGeneric = prob.length < 25 || GENERIC_PATTERNS.some(p => p.test(prob));

      if (isGeneric) {
        console.log("[AI] Bloqueando protocolo genérico:", prob);
        protocol.criar = false;

        // Perguntas de qualificação específicas
        if (/interfone/i.test(prob)) {
          userText = "Entendido. Para eu registrar corretamente, o interfone está mudo, não toca, não abre o portão, ou é outro problema?";
        } else if (/port[aã]o/i.test(prob)) {
          userText = "Certo. O portão não abre, não fecha, está fazendo barulho, ou é outro problema?";
        } else if (/c[aâ]mera|cftv/i.test(prob)) {
          userText = "Entendi. Qual câmera está com problema e o que está acontecendo? (sem imagem, imagem escura, offline...)";
        } else if (/cerca/i.test(prob)) {
          userText = "Certo. A cerca está disparando, não arma, ou é outro problema?";
        } else {
          userText = "Entendido. Poderia me dar mais detalhes sobre o que está acontecendo?";
        }
      }
    }

    // Se vai criar protocolo (passou no filtro)
    if (protocol?.criar === true) {
      const existing = await getOpenProtocol(supabase, conversationId);
      let protocolCode = "";

      if (existing) {
        console.log("[AI] Usando protocolo existente:", existing.protocol_code);
        protocolCode = existing.protocol_code;
      } else {
        const summary = String(protocol?.problema || "").trim() || lastUserText.slice(0, 500);
        const condRaw = String(protocol?.condominio_raw || "").trim();

        if (condRaw) {
          const { data: cur } = await supabase.from("conversations").select("pending_payload").eq("id", conversationId).maybeSingle();
          const pp = (cur?.pending_payload ?? {}) as any;
          pp.condo_raw_name = condRaw;
          await supabase.from("conversations").update({ pending_payload: pp }).eq("id", conversationId);
        }

        const created = await executeCreateProtocol(
          supabase, supabaseUrl, supabaseServiceKey, conversationId, participant_id,
          {
            summary: summary.slice(0, 500),
            category: protocol?.categoria || "operational",
            priority: protocol?.prioridade || "normal",
            condominium_name: condRaw || undefined,
          },
        );
        protocolCode = created?.protocol?.protocol_code || created?.protocol_code || "";
      }

      const code = protocolCode ? (String(protocolCode).startsWith("G7-") ? protocolCode : `G7-${protocolCode}`) : "registrado";

      const confirms = [
        `Certo. Chamado registrado (${code}). Já encaminhei para a equipe e seguimos por aqui.`,
        `Entendido. Protocolo ${code} registrado. Qualquer novidade, te aviso por aqui.`,
        `Perfeito. Registrei o chamado (${code}) e já encaminhei para o time.`,
      ];

      const msg = pickDeterministic(`${conversationId}:${code}`, confirms);
      const finalText = userText ? `${userText}\n\n${msg}` : msg;

      return new Response(JSON.stringify({
        text: finalText,
        finish_reason: "PROTOCOL_CREATED",
        provider: "gemini",
        model: geminiModel,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Normal reply
    return new Response(JSON.stringify({
      text: userText || llmText || null,
      finish_reason: "LLM_REPLY",
      provider: "gemini",
      model: geminiModel,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[AI] Error:", e);

    const safe = pickDeterministic(`${conversationId || "err"}:${nowMinuteBucket()}`, [
      "Entendido! Vou verificar e já retorno.",
      "Certo — vou checar isso e volto com uma resposta.",
    ]);

    return new Response(JSON.stringify({
      text: safe,
      error: String(e?.message || e),
      finish_reason: "ERROR_FALLBACK",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
