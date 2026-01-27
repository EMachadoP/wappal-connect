import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isEmployeeSender } from "../_shared/is-employee.ts";
import { parseAndExtract } from "../_shared/parse-extract.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- HELPERS ---

function isOperationalIssue(text: string) {
  return /(câmera|camera|cftv|dvr|gravador|nvr|port[aã]o|motor|cerca|interfone|controle de acesso|catraca|fechadura|tv coletiva|antena|acesso remoto|sem imagem|sem sinal|travado|n[aã]o abre|n[aã]o fecha|parou|quebrado|defeito)/i.test(text);
}

function needsApartmentByText(text: string) {
  return /(interfone|tv coletiva|antena|controle|tag|cart[aã]o|unidade|apto|apartamento)/i.test(text);
}

function isMissingCondoError(e: unknown) {
  return String((e as any)?.message || e).includes('MISSING_CONDOMINIUM');
}

function isMissingAptError(e: unknown) {
  return String((e as any)?.message || e).includes('MISSING_APARTMENT');
}

function hasUsefulText(t: string) {
  const s = (t || '').trim();
  if (!s) return false;
  if (/^(ok|sim|não|nao|blz|beleza|valeu|obrigad[oa]?)$/i.test(s)) return false;
  return true;
}

// ✅ NOVO: Detectar mensagens que são apenas confirmação/agradecimento
function isJustConfirmation(text: string): boolean {
  const normalized = (text || '').trim().toLowerCase()
    .replace(/[!.?,;:]+/g, '')  // Remove pontuação
    .replace(/\s+/g, ' ')        // Normaliza espaços
    .trim();

  // Lista de confirmações simples que NÃO devem abrir protocolo
  const CONFIRMATIONS = [
    'ok', 'okay', 'oks', 'okk', 'okok',
    'sim', 'sims', 'ss', 'sss',
    'nao', 'não', 'n',
    'blz', 'beleza', 'bele',
    'certo', 'certinho', 'ctz',
    'entendi', 'entendido',
    'combinado', 'fechado',
    'valeu', 'vlw', 'vlww',
    'obrigado', 'obrigada', 'obg', 'brigado', 'brigada',
    'ta', 'tá', 'ta bom', 'tá bom', 'tudo bem',
    'perfeito', 'otimo', 'ótimo',
    'show', 'top', 'massa',
    'pode ser', 'bora', 'vamos',
    'legal', 'tranquilo', 'tranquila',
    'boa', 'boa tarde', 'bom dia', 'boa noite',
    'ate mais', 'até mais', 'ate logo', 'até logo',
    'tchau', 'flw', 'falou', 'abraco', 'abraço'
  ];

  // Verifica match exato
  if (CONFIRMATIONS.includes(normalized)) return true;

  // Verifica se é muito curto (< 5 chars) e não é problema técnico
  if (normalized.length < 5 && !isOperationalIssue(normalized)) return true;

  // Verifica padrões comuns de confirmação
  if (/^(ok+|sim+|ss+|n[aã]o+|blz+|vlw+|obg|ta\s*bom)$/i.test(normalized)) return true;

  return false;
}

// ✅ NOVO: Verificar se protocolo foi criado recentemente nessa conversa
async function hasRecentProtocol(supabase: any, conversationId: string, withinMinutes: number = 30): Promise<boolean> {
  if (!conversationId) return false;

  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('protocols')
    .select('id, created_at')
    .eq('conversation_id', conversationId)
    .gte('created_at', cutoff)
    .limit(1);

  if (error) {
    console.warn('[AI] Error checking recent protocols:', error.message);
    return false;
  }

  return (data?.length || 0) > 0;
}

function extractApartment(text: string): string | null {
  const t = (text || "").trim();

  // “apto 1901”, “apt 1901”, “apartamento 1901”, “unidade 1901”
  const m1 = t.match(/\b(apto|apt|apartamento|unidade)\s*(?:n[ºo]\s*)?(?:#\s*)?(\d{1,6}[A-Za-z]?)\b/i);
  if (m1) return m1[2];

  // se vier só “1901”
  const m2 = t.match(/^\s*(\d{1,6}[A-Za-z]?)\s*$/);
  if (m2) return m2[1];

  return null;
}

function looksLikeApartment(text: string) {
  return Boolean(extractApartment(text));
}

function extractRequesterName(text: string): string | null {
  const t = (text || "").trim();

  // “meu nome é X”, “sou X”
  const m1 = t.match(/\b(meu nome é|sou)\s+([A-Za-zÀ-ÿ]{2,})(?:\s+([A-Za-zÀ-ÿ]{2,}))?/i);
  if (m1) return [m1[2], m1[3]].filter(Boolean).join(" ").trim();

  // “Luciana é apt 1901”
  const m2 = t.match(/^\s*([A-Za-zÀ-ÿ]{2,})(?:\s+([A-Za-zÀ-ÿ]{2,}))?\s+(?:é|eh)\b/i);
  if (m2) return [m2[1], m2[2]].filter(Boolean).join(" ").trim();

  return null;
}

function buildSummaryFromRecentUserMessages(msgs: { role: string; content: string }[], max = 3) {
  const users = msgs.filter(m => m.role === 'user').slice(-max).map(m => m.content);
  return users.join(' | ').slice(0, 500);
}

function getLastByRole(msgs: { role: string; content: string }[], role: string) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === role) return msgs[i];
  }
  return null;
}

// ✅ NEW: Check if user just answered the "which condominium?" question
function looksLikeCondoAnswer(text: string): boolean {
  const t = text.trim();
  // 2-60 chars, has letters, not just "ok/sim/não", no "?" at end
  if (t.length < 2 || t.length > 60) return false;
  if (!/[a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(t)) return false;
  if (/^(ok|sim|não|nao|obrigad[oa]?|valeu|blz|beleza)$/i.test(t)) return false;
  if (t.endsWith('?')) return false;
  // Avoid long technical complaints being treated as condo names
  if (isOperationalIssue(t) && t.length > 30) return false;
  return true;
}

// ✅ NEW: Check if last assistant message asked about condominium
function lastAssistantAskedForCondo(msgs: { role: string; content: string }[]): boolean {
  const lastAssistant = getLastByRole(msgs, 'assistant');
  if (!lastAssistant) return false;
  return /condom[ií]nio|qual (?:é )?o (?:seu )?condomínio|confirmar? (?:o )?condom/i.test(lastAssistant.content);
}

// ✅ NEW: Find condo candidate in recent history (not just when assistant asked)
function findRecentCondoCandidate(msgs: { role: string; content: string }[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "user") continue;

    const t = (m.content || "").trim();
    if (!t) continue;

    // Don't confuse apt with condo
    if (extractApartment(t)) continue;

    // Valid condominium candidate
    if (looksLikeCondoAnswer(t)) return t;
  }
  return null;
}

// ✅ NEW: Normalize text for fuzzy matching
function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s]/g, '') // remove punctuation
    .replace(/\b(condominio|residencial|edificio|conjunto)\b/gi, '') // remove common prefixes
    .trim()
    .replace(/\s+/g, ' ');
}

function tokensForCondoSearch(text: string): string[] {
  const norm = normalizeForSearch(text);
  return norm.split(" ").map(w => w.trim()).filter(w => w.length > 2);
}

function scoreCondoCandidate(userTokens: string[], condoName: string): number {
  const n = normalizeForSearch(condoName);
  let hit = 0;
  for (const tok of userTokens) if (n.includes(tok)) hit++;
  const all = (userTokens.length > 0 && hit === userTokens.length);
  // ✅ FIX: Massive bonus for "Golden Match" (substring or full containment)
  const exactSubstring = n.includes(userTokens.join(" ")) || userTokens.join(" ").includes(n);
  return (hit * 10) + (all ? 100 : 0) + (exactSubstring ? 50 : 0);
}

// ✅ NEW: Help identify if contact name is a generic building role
function isGenericContactName(name?: string | null) {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return true;

  const generic = [
    "portaria", "recepcao", "recepção", "guarita", "porteiro", "zelador", "zeladoria",
    "administracao", "administração", "sindico", "síndico", "condominio", "condomínio",
    "predio", "prédio", "edificio", "edifício"
  ];

  // só número ou muito curto
  if (/^\d+$/.test(n)) return true;
  if (n.length <= 3) return true;

  return generic.some(k => n.includes(k));
}

function translateCategory(category?: string): string {
  const map: Record<string, string> = {
    operational: "Operacional",
    support: "Suporte",
    financial: "Financeiro",
    commercial: "Comercial",
    admin: "Administrativo",
    cftv: "CFTV",
    interfone: "Interfone",
    antena_coletiva: "Antena Coletiva",
    portao_veicular: "Portão Veicular",
    porta_pedestre: "Porta Pedestre",
    controle_acesso_pedestre: "Acesso Pedestre",
    controle_acesso_veicular: "Acesso Veicular",
    infraestrutura: "Infraestrutura",
    cerca_eletrica: "Cerca Elétrica",
    alarme: "Alarme",
    concertina: "Concertina",
    infra: "Infraestrutura"
  };
  return map[category || ""] || "Operacional";
}

async function resolveCondoByTokens(supabase: any, userText: string) {
  const tokens = tokensForCondoSearch(userText);
  if (!tokens.length) return { kind: "none" as const };

  const patterns = tokens.slice(0, 5).map(t => `%${t}%`);

  const { data: candidates } = await supabase
    .from("condominiums")
    .select("id, name")
    .or(patterns.map(p => `name.ilike.${p}`).join(","))
    .limit(10);

  const list = (candidates || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    score: scoreCondoCandidate(tokens, c.name),
  })).sort((a: any, b: any) => b.score - a.score);

  if (!list.length) return { kind: "not_found" as const };

  // ✅ FIX: SEMPRE aceitar o melhor match, mesmo se houver outros parecidos
  // Não queremos frustrar o cliente com listas ou perguntas repetidas
  const best = list[0];

  // Se o score é razoável (>= 50), aceita
  if (best.score >= 50) {
    console.log(`[CONDO] Accepting best match: "${best.name}" (score: ${best.score})`);
    return { kind: "matched" as const, condo: best };
  }

  // Se o score é baixo mas é a única opção, aceita também
  if (list.length === 1) {
    console.log(`[CONDO] Accepting only match: "${best.name}" (score: ${best.score})`);
    return { kind: "matched" as const, condo: best };
  }

  // Só retorna not_found se realmente não houver nenhum candidato razoável
  console.log(`[CONDO] No good match found. Best was: "${best.name}" (score: ${best.score})`);
  return { kind: "not_found" as const };
}

function pickOptionIndex(text: string): number | null {
  const t = (text || "").toLowerCase().trim();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n >= 1 && n <= 3) return n - 1;
  }
  if (/\bprimeir[oa]\b/.test(t)) return 0;
  if (/\bsegund[oa]\b/.test(t)) return 1;
  if (/\bterceir[oa]\b/.test(t)) return 2;
  return null;
}

function pickByHash(id: string, arr: string[]) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h) + id.charCodeAt(i);
  return arr[Math.abs(h) % arr.length];
}

function fallbackQuestionForPending(pendingField: string | null) {
  if (pendingField === "condominium" || pendingField === "condominium_name")
    return "Por favor, poderia me confirmar o nome do seu condomínio?";
  if (pendingField === "apartment")
    return "Poderia me informar o número do seu apartamento ou unidade, por favor?";
  if (pendingField === "requester_name")
    return "Como devo te chamar? Por favor, me informe seu nome.";
  if (pendingField === "retry_protocol")
    return "Consegue me confirmar em poucas palavras o problema para eu tentar registrar novamente?";
  return "Como posso te ajudar hoje?";
}

const CONDO_QUESTIONS = [
  "Para que eu possa abrir o chamado corretamente, poderia me confirmar qual é o seu condomínio?",
  "Pra eu registrar certinho, qual é o nome do seu condomínio?",
  "Você me confirma o condomínio, por favor?",
  "Só pra localizar aqui: qual condomínio você representa?",
  "Perfeito — me diga o nome do condomínio pra eu abrir o chamado.",
  "Qual é o condomínio? (pode ser só o nome mesmo)",
];

function getCondoQuestion(conversationId: string): string {
  // Deterministic but varied: use hash of conversation_id
  let hash = 0;
  for (let i = 0; i < conversationId.length; i++) {
    hash = ((hash << 5) - hash) + conversationId.charCodeAt(i);
    hash |= 0;
  }
  return CONDO_QUESTIONS[Math.abs(hash) % CONDO_QUESTIONS.length];
}

// ---------- CONTEXT HYDRATION (avoid "perguntas bobas" / repetition) ----------
async function hydrateMessagesFromDbIfNeeded(
  supabase: any,
  conversationId: string | undefined,
  incoming: { role: string; content: string }[],
  minIncoming = 10,
  takeLast = 24
) {
  if (!conversationId) return incoming;
  if ((incoming?.length || 0) >= minIncoming) return incoming;

  const { data: rows, error } = await supabase
    .from('messages')
    .select('id, content, transcript, direction, sender_type, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: false })
    .limit(takeLast);

  if (error || !rows?.length) return incoming;

  const dbMsgs = rows
    .slice()
    .reverse()
    .map((r: any) => {
      const txt = (r.transcript ?? r.content ?? '').trim();
      if (!txt) return null;
      const role = r.direction === 'inbound' ? 'user' : 'assistant';
      return { role, content: txt };
    })
    .filter(Boolean) as { role: string; content: string }[];

  // merge + de-dupe (light)
  const merged = [...dbMsgs, ...(incoming || [])].filter(m => m.role !== 'system');
  const seen = new Set<string>();
  const deduped: { role: string; content: string }[] = [];
  for (const m of merged) {
    const k = `${m.role}::${m.content}`.slice(0, 600);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(m);
  }
  return deduped.slice(-40);
}

// ---------- Deterministic override -> LLM wording ----------
type DeterministicOverride =
  | { kind: 'need_condo' }
  | { kind: 'condo_clarification'; options: string[] }
  | { kind: 'condo_not_found'; condoName: string }
  | { kind: 'need_apartment' };

function buildOverrideInstruction(ov: DeterministicOverride): string {
  // Instruções em PT-BR, 1 pergunta por vez, humanizado, sem repetir.
  if (ov.kind === 'need_condo') {
    return [
      "Você precisa APENAS pedir o NOME DO CONDOMÍNIO para continuar.",
      "Faça UMA pergunta curta e natural.",
      "Não repita exatamente a frase anterior da conversa.",
      "Não use listas longas, não use emojis, não use texto em inglês.",
      "NÃO registre protocolo agora (não chamar ferramenta)."
    ].join("\n");
  }
  if (ov.kind === 'need_apartment') {
    return [
      "Você precisa APENAS pedir o NÚMERO DO APARTAMENTO para continuar.",
      "Faça UMA pergunta curta e natural.",
      "Não repita exatamente a frase anterior da conversa.",
      "Não use listas longas, não use emojis, não use texto em inglês.",
      "NÃO registre protocolo agora (não chamar ferramenta)."
    ].join("\n");
  }
  if (ov.kind === 'condo_clarification') {
    const opts = ov.options.slice(0, 3).join(" | ");
    return [
      "O cliente aparentemente informou o condomínio, mas existem opções parecidas no banco.",
      `Opções encontradas: ${opts}`,
      "Peça para escolher qual é o correto, em UMA pergunta curta e humana.",
      "Não faça parecer erro de sistema. Não diga 'não encontrei'.",
      "NÃO registre protocolo agora (não chamar ferramenta)."
    ].join("\n");
  }
  // condo_not_found
  return [
    `O cliente informou este condomínio: "${ov.condoName}".`,
    "Não houve correspondência clara no banco.",
    "Confirme o nome com tato, em UMA pergunta curta.",
    "Se houver outro nome (ex: 'Residencial X' vs 'Condomínio X'), peça para confirmar como aparece oficialmente.",
    "NÃO registre protocolo agora (não chamar ferramenta)."
  ].join("\n");
}

/**
 * Executes the create-protocol edge function
 */
async function executeCreateProtocol(
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string,
  conversationId: string,
  participantId: string | undefined,
  args: any
) {
  // Validate conversation_id first
  if (!conversationId) {
    console.error('[TICKET] executeCreateProtocol called with empty conversationId');
    throw new Error('conversation_id is required');
  }

  // ✅ FLEXIBLE: Apartamento é opcional
  // Se participante identificado → usa dados cadastrados
  // Se não identificado → IA extrai da conversa ou deixa em branco
  const summaryText = String(args?.summary || '');
  const apt = (args?.apartment || '').toString().trim();

  // Apenas LOG se parecer necessário mas não foi fornecido (não bloqueia)
  if (needsApartmentByText(summaryText) && !apt && !participantId) {
    console.warn('[TICKET] ⚠️ Apartamento pode ser necessário mas não fornecido (não bloqueando)');
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(conversationId)) {
    console.error('[TICKET] Invalid conversation_id format:', conversationId);
    throw new Error(`Invalid conversation_id format: ${conversationId}`);
  }

  console.log('[TICKET] Starting protocol creation for conversation:', conversationId);

  // ✅ FIX: Get pending payload to check for condo_raw_name
  const { data: convWithPayload, error: convPayloadError } = await supabase
    .from('conversations')
    .select('id, active_condominium_id, pending_payload, contacts(name), condominiums(name)')
    .eq('id', conversationId)
    .single();

  if (convPayloadError) {
    console.error('[TICKET] Failed to fetch conversation:', convPayloadError);
    throw new Error(`Failed to fetch conversation: ${convPayloadError.message}`);
  }

  if (!convWithPayload) {
    console.error('[TICKET] Conversation not found:', conversationId);
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const pendingPayload = (convWithPayload.pending_payload ?? {}) as any;
  const condominiumRawName =
    pendingPayload.condo_raw_name ||
    pendingPayload.condo_raw ||
    (pendingPayload.condominium_name) ||
    null;

  // ✅ MODIFIED: Só bloqueia se não tiver NEM ID NEM nome raw
  if (!convWithPayload.active_condominium_id && !condominiumRawName) {
    console.error('[TICKET] Missing active_condominium_id and no condo_raw_name');
    throw new Error('MISSING_CONDOMINIUM');
  }

  let condominiumId = convWithPayload.active_condominium_id;

  if (!condominiumId) {
    const { data: part } = await supabase
      .from('conversation_participants')
      .select('entity_id')
      .eq('conversation_id', conversationId)
      .not('entity_id', 'is', null)
      .limit(1)
      .single();
    if (part) condominiumId = part.entity_id;
  }

  // ✅ MODIFIED: Só bloqueia se não tiver NEM ID NEM nome raw
  if (!condominiumId && !condominiumRawName) {
    console.error('[TICKET] Missing condominiumId and no raw name - cannot create protocol');
    throw new Error('MISSING_CONDOMINIUM');
  }

  const bodyObj = {
    conversation_id: conversationId,
    condominium_id: condominiumId,
    condominium_name: condominiumRawName, // ✅ IMPORTANT: passa o nome raw quando não tem ID
    participant_id: participantId, // Pass participant_id for better condominium resolution
    summary: args.summary,
    priority: args.priority || 'normal',
    category: args.category || 'operational',
    requester_name: args.requester_name || (convWithPayload?.contacts as any)?.name || 'Não informado',
    requester_role: args.requester_role || 'Morador',
    apartment: args.apartment,
    notify_group: true, // IMPORTANT: Triggers WhatsApp + Asana
    notify_client: false // ✅ AI handles the response back to user
  };

  console.log('[TICKET] Calling create-protocol with body:', bodyObj);

  const response = await fetch(`${supabaseUrl}/functions/v1/create-protocol`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'apikey': supabaseServiceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyObj)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[TICKET] create-protocol failed with status:', response.status);
    console.error('[TICKET] Error response:', errorText);
    console.error('[TICKET] Payload sent:', JSON.stringify(bodyObj, null, 2));
    throw new Error(`Create protocol failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log('[TICKET] create-protocol SUCCESS:', result);
  return result;
}

async function clearPending(conversationId: string, supabase: any) {
  await supabase.from('conversations')
    .update({ pending_field: null, pending_payload: null, pending_set_at: null })
    .eq('id', conversationId);
}

async function setPending(conversationId: string, field: string, supabase: any, payload: any = {}) {
  await supabase.from('conversations')
    .update({
      pending_field: field,
      pending_payload: payload,
      pending_set_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
}

// --- LOCK HELPERS ---
async function acquireLock(supabase: any, conversationId: string) {
  try {
    const now = new Date().toISOString();

    // 1. Limpa locks expirados de qualquer conversa (manutenção preventiva)
    await supabase
      .from('ai_conversation_locks')
      .delete()
      .lt('locked_until', now);

    // 2. Tenta inserir lock para esta conversa
    // locked_until: 20 segundos de trava para evitar colisão imediata
    const lockedUntil = new Date(Date.now() + 20 * 1000).toISOString();

    const { error } = await supabase
      .from('ai_conversation_locks')
      .insert({
        conversation_id: conversationId,
        locked_until: lockedUntil,
        lock_owner: 'ai-generate-reply'
      });

    if (error?.code === '23505') {
      console.log('[AI] 🔒 Lock busy for conversation (23505):', conversationId);
      return false;
    }

    if (error) {
      if (error.message?.includes('ai_conversation_locks')) {
        console.warn('[AI] ⚠️ Lock table missing or cache error. Proceeding without lock.');
        return true;
      }
      throw error;
    }

    return true;
  } catch (e: any) {
    console.warn('[AI] ⚠️ acquireLock exception:', e.message);
    return true; // Resilience: segue se infra de lock falhar
  }
}

// --- SERVE ---

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  let cid: string | undefined;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const rawBody = await req.json();
    const conversationIdRaw = rawBody.conversation_id || rawBody.conversationId || rawBody.conversation?.id;
    cid = (typeof conversationIdRaw === 'string') ? conversationIdRaw : undefined;

    // ✅ ADQUIRIR LOCK (Previne concorrência)
    if (cid) {
      const locked = await acquireLock(supabase, cid);
      if (!locked) {
        console.log('[AI] 🔒 Lock busy for conversation:', cid);
        return new Response(JSON.stringify({ text: null, skipped: "lock_busy" }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const messages = (rawBody.messages || []).slice(0, 50); // Limit to 50
    const conversationId = cid; // Keep internal name compatibility
    let participant_id = rawBody.participant_id; // Extract participant_id from request

    // Dynamically clean passed systemPrompt from negative examples (mimicry prevention)
    let basePrompt = rawBody.systemPrompt || "";
    basePrompt = basePrompt.split(/EXEMPLO ERRADO|EXEMPLO DE ERRO|MIMETISMO/i)[0].trim();

    let messagesNoSystem = messages.filter((m: any) => m.role !== 'system');
    // ✅ If app sent short context, hydrate from DB to avoid repetition
    messagesNoSystem = await hydrateMessagesFromDbIfNeeded(supabase, conversationId, messagesNoSystem);

    // ✅ FIX: Verificar se é primeira interação (sem histórico de assistant)
    const assistantMessages = messagesNoSystem.filter((m: any) => m.role === 'assistant');
    const isFirstInteraction = assistantMessages.length === 0;

    if (isFirstInteraction) {
      console.log('[AI] 👋 First interaction detected - will follow greeting flow, no auto-protocol');
    }

    // Get last user message and recent context
    const lastUserMsg = getLastByRole(messagesNoSystem, 'user');
    const lastUserMsgText = (lastUserMsg?.content || "").trim();
    const recentText = messagesNoSystem.slice(-6).map((m: any) => m.content).join(" ");

    // --- TIER 0: STATE MACHINE & RETRY PROTOCOL ---
    // Handle pending states BEFORE extensive processing

    const { data: convState, error: convStateErr } = await supabase
      .from('conversations')
      .select('id, active_condominium_id, pending_field, pending_payload, pending_set_at')
      .eq('id', conversationId)
      .maybeSingle();

    if (convStateErr) console.error('[STATE] Failed to load conv state:', convStateErr);

    if (conversationId && convState?.pending_field === 'retry_protocol') {
      console.log('[STATE] pending_field=retry_protocol');

      const payload = (convState.pending_payload || {}) as any;
      const summaryFromPayload = String(payload.last_summary || '').trim();
      const priorityFromPayload = payload.last_priority || 'normal';
      const aptFromPayload = payload.last_apartment || null;

      // Se o usuário mandou algo útil, usa como summary novo (mais recente)
      const newSummary = hasUsefulText(lastUserMsgText) ? lastUserMsgText : summaryFromPayload;

      // ✅ FIX: CONTEXT AWARENESS - Check active_condominium_id BEFORE asking
      let activeCondoId = convState?.active_condominium_id || payload?.active_condominium_id;
      let activeCondoName = null;

      if (!activeCondoId && conversationId) {
        // Double check DB if missing in state
        const { data: c } = await supabase.from('conversations').select('active_condominium_id, condominiums(name)').eq('id', conversationId).single();
        if (c?.active_condominium_id) {
          activeCondoId = c.active_condominium_id;
          activeCondoName = c.condominiums?.name;
          console.log(`[STATE] 🧠 Context Aware: Found active_condominium_id=${activeCondoId}`);
        }
      }

      try {
        const ticketData = await executeCreateProtocol(
          supabase, supabaseUrl, supabaseServiceKey, conversationId,
          participant_id,
          {
            summary: (newSummary || summaryFromPayload).slice(0, 500),
            priority: priorityFromPayload,
            apartment: aptFromPayload,
            condominium_id: activeCondoId, // Inject context
            condominium_name: activeCondoName
          }
        );

        const protocolCode = ticketData.protocol?.protocol_code || ticketData.protocol_code;

        // ✅ sucesso -> limpa pendência
        await clearPending(conversationId, supabase);

        const protocol = ticketData.protocol || ticketData;
        const nowBr = new Date().toLocaleString("pt-BR", { timeZone: "America/Recife" });

        const lines = [
          "🎯 Seu chamado foi registrado com sucesso:",
          "",
          `✅ Protocolo: ${protocol.protocol_code || protocol.code || protocol.protocol_number || protocol.id}`,
          `📌 Categoria: ${translateCategory(protocol.category)}`,
          `🟢 Prioridade: ${protocol.priority || "normal"}`,
          `⏰ Vencimento: ${protocol.due_date ? String(protocol.due_date).slice(0, 10) : "-"}`,
          `🕒 Data e hora: ${nowBr}`,
        ];

        let finalMsg = lines.join("\n");
        if (!activeCondoId) {
          finalMsg += "\n\nPra agilizar, me diga o condomínio quando puder (pode ser só o nome mesmo).";
        }

        return new Response(JSON.stringify({
          text: finalMsg,
          finish_reason: 'RETRY_PROTOCOL_SUCCESS',
          provider: 'state-machine',
          model: 'deterministic',
          request_id: crypto.randomUUID()
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        console.error('[STATE] retry_protocol failed again:', e);

        // ✅ BREAK LOOP: If specific data is missing, switch to that state instead of looping in retry
        if (isMissingCondoError(e)) {
          await setPending(conversationId, 'condominium_name', supabase, {
            ...payload,
            last_summary: newSummary || summaryFromPayload
          });
          return new Response(JSON.stringify({
            text: "Quase lá! Para concluir o registro, você poderia me confirmar o nome do seu condomínio, por favor?",
            finish_reason: 'SWITCH_TO_CONDO',
            provider: 'state-machine',
            model: 'deterministic'
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        if (isMissingAptError(e)) {
          await setPending(conversationId, 'apartment', supabase, {
            ...payload,
            last_summary: newSummary || summaryFromPayload
          });
          return new Response(JSON.stringify({
            text: "Entendido. Para finalizar, poderia me informar o número do seu apartamento ou unidade?",
            finish_reason: 'SWITCH_TO_APT',
            provider: 'state-machine',
            model: 'deterministic'
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // ✅ FIX: Prevent infinite retry loop - after 2 attempts, force switch to condominium_name
        const retryCount = (payload?.retry_count || 0) + 1;

        if (retryCount >= 2) {
          console.log(`[STATE] retry_protocol failed ${retryCount} times. Forcing switch to condominium_name.`);
          await setPending(conversationId, 'condominium_name', supabase, {
            ...payload,
            last_summary: newSummary || summaryFromPayload,
            retry_count: 0, // Reset counter
          });
          return new Response(JSON.stringify({
            text: "Vamos tentar de outro jeito. Para registrar seu chamado, preciso saber: qual é o nome do seu condomínio?",
            finish_reason: 'FORCE_SWITCH_TO_CONDO',
            provider: 'state-machine',
            model: 'deterministic'
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // ✅ First retry with message variation (more human)
        const RETRY_MESSAGES = [
          "Desculpe, tive um problema técnico aqui. Pode repetir qual é o chamado que você precisa abrir?",
          "Ops, deu um erro no sistema. Me confirma de novo o problema, por favor?",
          "Perdão, tive uma falha técnica. Você pode me dizer novamente qual é a situação?",
        ];

        // Deterministic variation based on conversation_id
        let hash = 0;
        for (let i = 0; i < conversationId.length; i++) {
          hash = ((hash << 5) - hash) + conversationId.charCodeAt(i);
          hash |= 0;
        }
        const retryMessage = RETRY_MESSAGES[Math.abs(hash + retryCount) % RETRY_MESSAGES.length];

        await setPending(conversationId, 'retry_protocol', supabase, {
          ...payload,
          last_summary: newSummary || summaryFromPayload,
          last_error: String(e.message || e).slice(0, 500),
          retry_count: retryCount,
        });

        return new Response(JSON.stringify({
          text: retryMessage,
          finish_reason: 'RETRY_PROTOCOL_STILL_FAILING',
          provider: 'state-machine',
          model: 'deterministic'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // --- EMPLOYEE DETECTION & STRUCTURED EXTRACTION ---
    // Load the last message's raw_payload for employee detection
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('id, content, transcript, raw_payload, sender_type, direction')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastIsFromAgent =
      (lastMsg?.direction === 'outbound') ||
      (String(lastMsg?.sender_type || '').toLowerCase() === 'agent');

    const rawPayload = lastMsg?.raw_payload ?? {};
    const employee = await isEmployeeSender(supabase, rawPayload);
    const isEmployee = employee.isEmployee;

    // Use transcript if available (audio messages), otherwise content
    const textForExtraction = (lastMsg?.transcript ?? lastMsg?.content ?? lastUserMsgText).replace(/^🎤\s*/, '').trim();

    // Check for employee command patterns
    const hasCommand = /^CRIAR\s+AGENDAMENTO\b|^ABRIR\s+CHAMADO\b|^ABRIR\s+PROTOCOLO\b|^CHAMADO\s*:|^AGENDA\s*:/i.test(textForExtraction);

    // If employee WITHOUT command → skip AI response (just register the message)
    // ✅ PATCH: Allow 'owner' or 'admin' roles to bypass this block
    const isPrivileged = (employee.roles ?? []).some(r => ['owner', 'admin'].includes(String(r).toLowerCase()));

    if (isEmployee && lastIsFromAgent && !hasCommand && !isPrivileged) {
      console.log('[AI] Employee message without command, skipping AI response.');
      return new Response(JSON.stringify({
        text: null,
        skipped: 'employee_no_command',
        finish_reason: 'SKIPPED',
        provider: 'employee-detection',
        model: 'none',
        request_id: crypto.randomUUID()
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // If employee WITH command → structured extraction
    if (isEmployee && hasCommand && conversationId) {
      console.log('[AI] Employee command detected, extracting structured data...');

      // Load conversation's linked condominium (if any)
      const { data: convoWithCondo } = await supabase
        .from('conversations')
        .select('active_condominium_id, condominiums(name)')
        .eq('id', conversationId)
        .maybeSingle();

      const linkedCondoName = (convoWithCondo?.condominiums as any)?.name ?? null;
      const linkedCondoId = convoWithCondo?.active_condominium_id ?? null;

      // Load known condominiums to help extraction
      const { data: condos } = await supabase.from('condominiums').select('name').limit(500);
      const knownCondominiums = (condos ?? []).map((c: any) => c.name).filter(Boolean);

      const extracted = await parseAndExtract(null, {
        text: textForExtraction,
        isEmployee: true,
        knownCondominiums
      });

      // Auto-fill condominium from conversation link if not in text
      if (!extracted.fields.condominium_name && linkedCondoName) {
        console.log('[AI] Using linked condominium from conversation:', linkedCondoName);
        extracted.fields.condominium_name = linkedCondoName;
        extracted.missing_fields = extracted.missing_fields.filter(f => f !== 'condominium_name');
        extracted.draft = extracted.missing_fields.length > 0;
      }

      if (extracted.intent === 'create_schedule' || extracted.intent === 'create_protocol') {
        // If missing required fields, ask for them
        if (extracted.draft && extracted.missing_fields.length > 0) {
          const missing = extracted.missing_fields[0];
          let question = '';
          if (missing === 'condominium_name') question = 'Qual é o condomínio?';
          else if (missing === 'category') question = 'Qual é o tipo do serviço? (Portão, CFTV, Interfone, TV Coletiva)';
          else if (missing === 'summary') question = 'Descreva em uma frase o problema a ser atendido.';
          else question = `Por favor, informe: ${missing}`;

          return new Response(JSON.stringify({
            text: `📋 Entendido, ${employee.profileName}. ${question}`,
            finish_reason: 'NEED_EMPLOYEE_INPUT',
            provider: 'employee-extraction',
            model: 'parse-extract',
            request_id: crypto.randomUUID(),
            extracted
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // All data available - create the protocol
        try {
          const ticketData = await executeCreateProtocol(supabase, supabaseUrl, supabaseServiceKey, conversationId, participant_id, {
            summary: extracted.fields.summary || 'Agendamento solicitado via funcionário',
            priority: extracted.fields.urgency === 'high' ? 'critical' : 'normal',
            category: extracted.fields.category || 'operational',
            requester_name: `G7 Serv (${employee.profileName})`,
            requester_role: 'Funcionário',
          });

          const protocolCode = ticketData.protocol?.protocol_code || ticketData.protocol_code;
          return new Response(JSON.stringify({
            text: `✅ Pronto, ${employee.profileName}! Protocolo **${protocolCode}** criado com sucesso.\n\n📍 ${extracted.fields.condominium_name || 'Condomínio não especificado'}\n🔧 ${extracted.fields.category || 'Categoria não especificada'}\n📝 ${extracted.fields.summary}`,
            finish_reason: 'EMPLOYEE_PROTOCOL_CREATED',
            provider: 'employee-extraction',
            model: 'parse-extract',
            request_id: crypto.randomUUID()
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } catch (e) {
          console.error('[AI] Employee protocol creation failed:', e);
          // Fall through to normal flow
        }
      }
    }

    // --- TIER 4: DETERMINISTIC (Bulletproof Context-Aware) ---
    const { data: convData } = await supabase
      .from('conversations')
      .select('active_condominium_id, pending_field, pending_payload, contact_id')
      .eq('id', conversationId)
      .maybeSingle();

    const pendingField = (convData?.pending_field ?? null) as string | null;
    const pendingPayload = (convData?.pending_payload ?? {}) as any;
    let hasIdentifiedCondo = Boolean(convData?.active_condominium_id);

    // ✅ AUTO-LINK: Use contact's registered condominium for single-building roles
    if (!hasIdentifiedCondo && conversationId) {
      const SINGLE_CONDO_ROLES = [
        'sindico', 'subsindico', 'zelador', 'morador',
        'porteiro', 'conselheiro', 'gerente_predio'
      ];

      // Get contact info with entity via participants
      const { data: participant } = await supabase
        .from('participants')
        .select('role_type, entity_id, entities(name)')
        .eq('contact_id', convData.contact_id)
        .eq('is_primary', true)
        .maybeSingle();

      if (participant && participant.entity_id) {
        const role = String(participant.role_type || '').toLowerCase();

        if (SINGLE_CONDO_ROLES.includes(role)) {
          console.log(`[AUTO-LINK] Role "${role}" → auto-using condominium ${participant.entity_id}`);

          await supabase.from('conversations').update({
            active_condominium_id: participant.entity_id,
            active_condominium_confidence: 1.0
          }).eq('id', conversationId);

          hasIdentifiedCondo = true;
        }
      }
    }

    const lastIssueMsg = [...messagesNoSystem].reverse().find((m: any) => m.role === 'user' && isOperationalIssue(m.content));
    const hasOperationalContext = isOperationalIssue(recentText);

    // 1) sempre tentar extrair “nome/apto” do texto atual (mesmo sem pending)
    const autoApt = extractApartment(lastUserMsgText);
    const autoName = extractRequesterName(lastUserMsgText);

    if (conversationId && (autoApt || autoName)) {
      const patch: any = { pending_payload: { ...pendingPayload } };
      if (autoApt) patch.pending_payload.apartment = autoApt;
      if (autoName) patch.pending_payload.requester_name = autoName;

      await supabase.from("conversations").update(patch).eq("id", conversationId);
    }

    // 2) se estava pendente de algo, interpretar resposta e atualizar estado
    if (conversationId && pendingField) {
      if (pendingField === "condominium") {
        const r = await resolveCondoByTokens(supabase, lastUserMsgText);

        if (r.kind === "matched") {
          await supabase.from("conversations").update({
            active_condominium_id: r.condo.id,
            pending_field: null,
            pending_payload: { ...pendingPayload, condo_options: null },
            pending_set_at: null
          }).eq("id", conversationId);
          hasIdentifiedCondo = true;
        } else {
          // ✅ Aceita o nome raw e segue
          await supabase.from("conversations").update({
            pending_field: null,
            pending_payload: { ...pendingPayload, condo_raw_name: lastUserMsgText },
            pending_set_at: null
          }).eq("id", conversationId);
        }
      }

      // ✅ Proactive condo detection from history - accept without re-asking
      if (!hasIdentifiedCondo && conversationId) {
        const candidate = findRecentCondoCandidate(messagesNoSystem);
        if (candidate) {
          console.log(`[AI] Proactive condo candidate found: "${candidate}"`);
          const r = await resolveCondoByTokens(supabase, candidate);

          if (r.kind === "matched") {
            await supabase.from("conversations").update({
              active_condominium_id: r.condo.id,
              active_condominium_confidence: 0.8
            }).eq("id", conversationId);
            hasIdentifiedCondo = true;
            console.log(`[AI] ✅ Proactive match accepted: "${r.condo.name}"`);
          } else {
            // ✅ Aceita o nome raw sem perguntar de novo
            await supabase.from("conversations").update({
              pending_payload: { ...pendingPayload, condo_raw_name: candidate }
            }).eq("id", conversationId);
            console.log(`[AI] ⚠️ Proactive raw name stored: "${candidate}"`);
          }
        }
      }

      // ✅ FIX: Escape hatch with condoStepDone flag
      // ✅ FIX: Simplified condominium resolution - accept on first attempt
      if (pendingField === "condominium_name") {
        const lastText = lastUserMsgText.trim();

        // Tentar resolver por tokens
        const r = await resolveCondoByTokens(supabase, lastText);

        if (r.kind === "matched") {
          // ✅ Encontrou! Aceita e segue
          await supabase.from("conversations").update({
            active_condominium_id: r.condo.id,
            pending_field: null,
            pending_payload: { ...pendingPayload, condo_options: null },
            pending_set_at: null,
          }).eq("id", conversationId);

          hasIdentifiedCondo = true;
          console.log(`[CONDO] ✅ Matched and accepted: "${r.condo.name}"`);

        } else {
          // ✅ Não encontrou no banco? ACEITA O NOME RAW e segue
          // O protocolo será criado com o nome que o cliente informou
          // A equipe ajusta depois se necessário
          console.log(`[CONDO] ⚠️ Not found in DB, accepting raw name: "${lastText}"`);

          pendingPayload.condo_raw_name = lastText;
          pendingPayload.condo_not_in_db = true;

          await supabase.from("conversations").update({
            pending_field: null,
            pending_payload: pendingPayload,
            pending_set_at: null,
          }).eq("id", conversationId);

          // NÃO seta hasIdentifiedCondo = true, pois não temos ID
          // Mas também NÃO retorna pedindo confirmação - segue em frente
        }

        // ✅ Continua o fluxo normalmente (não retorna aqui)
      }

      if (pendingField === "apartment") {
        // ✅ SAFETY FIX: If we are asking for apartment but somehow lost the Condo ID, go back!
        if (!hasIdentifiedCondo) {
          await setPending(conversationId, 'condominium_name', supabase, pendingPayload);
          return new Response(JSON.stringify({
            text: "Perdão, antes de verificarmos a unidade, qual é o nome do condomínio?",
            finish_reason: 'BACKTRACK_TO_CONDO',
            provider: 'state-machine',
            model: 'deterministic'
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const apt = extractApartment(lastUserMsgText);
        if (apt) {
          await supabase.from("conversations").update({
            pending_field: null,
            pending_payload: { ...pendingPayload, apartment: apt },
            pending_set_at: null
          }).eq("id", conversationId);
        }
      }

      if (pendingField === "requester_name") {
        const nm = extractRequesterName(lastUserMsgText);
        if (nm) {
          await supabase.from("conversations").update({
            pending_field: null,
            pending_payload: { ...pendingPayload, requester_name: nm },
            pending_set_at: null
          }).eq("id", conversationId);
        }
      }
    }

    // Recalcular contexto para as próximas verificações
    const aptCandidate = [...messagesNoSystem]
      .reverse()
      .map((m: any) => (m.role === "user" ? extractApartment(m.content) : (m.role === "system" && m.payload?.apartment ? m.payload.apartment : null)))
      .find(Boolean) || pendingPayload?.apartment || null;

    // ✅ FIX: Buscar role do contato para não pedir APT de funcionários
    let contactRole = '';
    if (convData?.contact_id) {
      const { data: participantData } = await supabase
        .from('participants')
        .select('role_type')
        .eq('contact_id', convData.contact_id)
        .eq('is_primary', true)
        .maybeSingle();
      contactRole = String(participantData?.role_type || '').toLowerCase();
    }

    // ✅ FIX: Porteiros e funcionários NÃO precisam informar apartamento
    const ROLES_WITHOUT_APARTMENT = ['porteiro', 'zelador', 'funcionario', 'gerente_predio', 'administrador'];
    const roleSkipsApartment = ROLES_WITHOUT_APARTMENT.includes(contactRole);

    const textNeedsApartment = /(interfone|tv|controle|apartamento|apto|unidade)/i.test(recentText);
    const needsApartment = textNeedsApartment && !roleSkipsApartment;

    if (roleSkipsApartment && textNeedsApartment) {
      console.log(`[AI] Skipping apartment requirement for role: ${contactRole}`);
    }

    // ✅ FIX: Considerar "condomínio identificado" quando tem ID OU nome raw (escape hatch)
    const condoRawName = (pendingPayload?.condo_raw_name || pendingPayload?.condo_raw || pendingPayload?.condominium_raw_name || null);

    const hasIdentifiedCondoId = Boolean(convData?.active_condominium_id);
    const hasCondoInfo = hasIdentifiedCondoId || Boolean(condoRawName && String(condoRawName).trim().length > 0);

    // ✅ FIX: Exigir histórico mínimo de conversa antes de abrir protocolo automaticamente
    const messageCount = messagesNoSystem?.length || 0;
    const hasMinimumConversation = messageCount >= 6; // Pelo menos 3 trocas (user + assistant)

    // ✅ FIX: NUNCA responder deterministicamente se a última mensagem for uma pergunta
    const isQuestion = lastUserMsgText.endsWith('?');

    // ✅ FIX: Verificar se a IA já fez pelo menos uma pergunta de triagem (ou se já tem contexto operacional forte)
    const aiAskedQuestion = messagesNoSystem.some((m: any) =>
      m.role === 'assistant' && /\?/.test(m.content)
    );

    // Se o contexto operacional é muito forte (ex: "portão quebrado"), relaxamos a exigência de pergunta prévia da IA
    const strongOperationalContext = /quebrado|parado|não funciona|travou|emergência/i.test(recentText);

    // ✅ FIX: Verificar se a mensagem é apenas confirmação (Patch 14)
    const isConfirmationOnly = isJustConfirmation(lastUserMsgText);

    if (isConfirmationOnly) {
      console.log(`[AI] 🛑 Skipping protocol - message is just confirmation: "${lastUserMsgText}"`);
    }

    const canOpenNow = hasCondoInfo
      && hasOperationalContext
      && (!needsApartment || Boolean(aptCandidate))
      && (hasMinimumConversation || strongOperationalContext)
      && aiAskedQuestion // ✅ FIX: SEMPRE exige que a IA tenha feito pelo menos 1 pergunta
      && !isQuestion
      && !isConfirmationOnly; // ✅ NOVO: Não abrir se for apenas confirmação

    // ✅ FIX: re-declare for downstream uses
    const isProvidingApartment = Boolean(extractApartment(lastUserMsgText)) && hasOperationalContext;
    const isProvidingApartmentWithCondo = isProvidingApartment && hasCondoInfo && hasMinimumConversation;
    const canActuallyOpen = canOpenNow;

    // ✅ FIX: Verificar se já tem protocolo recente antes de abrir outro (Patch 14)
    const alreadyHasRecentProtocol = conversationId ? await hasRecentProtocol(supabase, conversationId, 30) : false;

    // ✅ FIX: Log para debug
    if (canOpenNow && !hasMinimumConversation && !strongOperationalContext) {
      console.log(`[AI] ⏸️ Skipping auto-open: insufficient conversation history (${messageCount} messages, need 6+)`);
    }
    if (canOpenNow && !aiAskedQuestion && !strongOperationalContext) {
      console.log(`[AI] ⏸️ Skipping auto-open: AI hasn't asked any questions yet`);
    }
    if (alreadyHasRecentProtocol && isConfirmationOnly) {
      console.log(`[AI] 🛑 Skipping - recent protocol exists and message is confirmation`);
    }

    // ✅ FIX: NUNCA abrir protocolo automaticamente na primeira interação
    if (conversationId && (canActuallyOpen || isProvidingApartmentWithCondo) && !isFirstInteraction && !alreadyHasRecentProtocol && !isConfirmationOnly) {
      try {
        const ticketData = await executeCreateProtocol(
          supabase,
          supabaseUrl,
          supabaseServiceKey,
          conversationId,
          participant_id,
          {
            summary: (lastIssueMsg?.content || lastUserMsgText).slice(0, 500),
            priority: /travado|urgente|urgência|emergência/i.test(recentText) ? 'critical' : 'normal',
            category: 'operational', // Deterministic is always technical/operational
            apartment: aptCandidate,
            requester_name: pendingPayload?.requester_name || undefined
          }
        );

        const protocolCode = ticketData.protocol?.protocol_code || ticketData.protocol_code;
        const officialCode = protocolCode.startsWith("G7-") ? protocolCode : `G7-${protocolCode}`;

        // Limpar estados pendentes após sucesso
        await supabase.from("conversations").update({
          pending_field: null,
          pending_payload: {},
          pending_set_at: null
        }).eq("id", conversationId);

        // Protocol confirmation variations - CLEAN & NEUTRAL
        const CONFIRMS = [
          `Certo. Chamado registrado sob o protocolo ${officialCode}. Já encaminhei para a equipe operacional e seguimos por aqui.`,
          `Perfeito — protocolei como ${officialCode}. Já direcionei para a equipe operacional e vamos acompanhando por aqui.`,
          `Entendido. Protocolo ${officialCode} registrado e encaminhado. Qualquer ajuste ou detalhe, me avise por aqui.`,
          `Combinado. Registrei o chamado (${officialCode}) e já deixei encaminhado para a equipe. Seguimos por aqui.`
        ];
        // Choose variation deterministic (stable)
        let h = 0; const seed = `${conversationId}:${protocolCode}`;
        for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
        let msg = CONFIRMS[h % CONFIRMS.length];

        // ✅ PATCH 10: SILENT MATCH - Never repeat the condo name in the final msg if it was a technical match
        // Only add footer if we REALLY have NO info at all.
        if (!hasCondoInfo) {
          msg += "\n\nPra agilizar, me diga o condomínio quando puder (pode ser só o nome mesmo).";
        }

        return new Response(JSON.stringify({
          text: msg,
          finish_reason: 'DETERMINISTIC_SUCCESS',
          provider: 'deterministic',
          model: 'keyword-detection',
          request_id: crypto.randomUUID()
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e) {
        console.error("Deterministic opening failed, falling back to LLM...", e);
      }
    }

    // ✅ NOVO: Resposta inteligente para confirmações após protocolo recente (Patch 14)
    if (conversationId && isConfirmationOnly && alreadyHasRecentProtocol) {
      // ✅ FIX: Respostas SEMPRE humanizadas (sem silêncio)
      const CONFIRMATION_RESPONSES = [
        "👍",
        "Combinado!",
        "Perfeito!",
        "Certo, qualquer coisa me avise.",
        "Disponha!",
        "Fico à disposição.",
        "Beleza!",
        "Pode contar comigo.",
      ];

      // Hash para escolha determinística (mas variada por conversa + tempo)
      let hash = 0;
      const seed = `${conversationId}:${Math.floor(Date.now() / 60000)}`; // Varia a cada minuto
      for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
        hash |= 0;
      }

      const response = CONFIRMATION_RESPONSES[Math.abs(hash) % CONFIRMATION_RESPONSES.length];

      console.log(`[AI] 👍 Humanized response to confirmation: "${response}"`);
      return new Response(JSON.stringify({
        text: response,
        finish_reason: 'CONFIRMATION_RESPONSE',
        provider: 'deterministic',
        model: 'confirmation-handler'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- TIER 5: IA (LLM) ---

    // 5.1 Recarregar estado atualizado para o Hint
    const { data: stateNow } = await supabase
      .from("conversations")
      .select("pending_field, pending_payload, active_condominium_id")
      .eq("id", conversationId)
      .maybeSingle();

    const pf = (stateNow?.pending_field ?? null) as string | null;
    const pp = (stateNow?.pending_payload ?? {}) as any;

    // ✅ Define activeCondoId for the standard LLM flow
    const activeCondoId = stateNow?.active_condominium_id || pp?.active_condominium_id;

    // ✅ PATCH 10 + 11: ANTI-ROBOT GREETING LOGIC
    // Only use name if:
    // 1. User EXPLICITLY provided it as a greeting in recent messages
    // 2. OR user is identified with a personal role (NOT Portaria/Shared)
    let greeting = "";
    const userMentionedName = messagesNoSystem.some((m: any) =>
      m.role === 'user' && /(meu nome é|sou (o|a)?)\s+([A-Za-zÀ-ÿ]{2,})/i.test(m.content)
    );

    const SAFE_PERSONAL_ROLES = ['sindico', 'subsindico', 'morador', 'gerente_predio', 'supervisor', 'admin', 'owner'];
    const isSafeRole = SAFE_PERSONAL_ROLES.includes(contactRole);

    if (pp?.requester_name && !isGenericContactName(pp.requester_name)) {
      if (userMentionedName || isSafeRole) {
        greeting = `Olá, ${pp.requester_name}! `;
      } else {
        greeting = "Olá! ";
      }
    } else {
      greeting = "Olá! ";
    }

    const stateHint =
      pf === "condominium" && pp?.condo_options?.length
        ? `PENDENTE: confirmar condomínio. Opções encontradas: ${pp.condo_options.map((o: any) => o.name).join(" | ")}. Peça para o cliente escolher uma.`
        : pf === "condominium"
          ? `PENDENTE: confirmar o nome do condomínio (ainda não identificado).`
          : pf === "apartment"
            ? `PENDENTE: confirmar o número do apartamento/unidade.`
            : pf === "requester_name"
              ? `PENDENTE: confirmar o nome do solicitante.`
              : `SEM PENDÊNCIAS.`;

    // Final Prompt Reinforcement
    const cleanPrompt = `${basePrompt}

[ESTADO INTERNO - NÃO MOSTRAR AO CLIENTE]
${stateHint}

REGRAS DE EXECUÇÃO:
- Responda sempre em português natural e amigável. Mostre empatia (ex: "Sinto muito pelo problema com o portão, vamos resolver isso").
- Tente interpretar o que o cliente quer dizer, mesmo que ele use termos leigos ou frases incompletas.
- Se o cliente responder apenas "Ok", "Sim", "Obrigado" ou similar após um chamado registrado, use uma resposta curta e humana como "Disponha!", "Qualquer coisa estamos aqui!", etc.
- Se já foi aberto um protocolo nessa conversa recentemente, NÃO abra outro a menos que o cliente relate um NOVO problema claramente diferente.
- Não repita perguntas já respondidas no histórico.
- Só chame create_protocol quando tiver: nome do condomínio + descrição clara + (apartamento quando for unidade) + nome do solicitante.
- CATEGORIAS DE PROTOCOLO:
    - 'operational': Falhas técnicas, defeitos físicos, portões, interfones, câmeras. (ESTA NOTIFICA O GRUPO TÉCNICO).
    - 'admin': Pedidos de cópia de contrato, cadastros, troca de tags, dúvidas administrativas.
    - 'financial': Segunda via de boleto, dúvidas de pagamento.
    - 'support': Dúvidas gerais de uso do sistema.
- NÃO abra protocolos 'admin' ou 'support' para simples pedidos de informação que você possa responder ou que levasse o cliente a resolver sozinho, a menos que ele peça formalmente um registro/chamado.
- Evite blocos estruturados ou listas enumeradas a menos que seja estritamente necessário para clareza. Sua fala deve ser fluida como uma pessoa.

REGRAS DE SILENT MATCH (PATCH 10):
- NUNCA repita o nome formal do Condomínio se ele foi "adivinhado" ou "auto-vinculado". 
- Ex: Se o usuário diz "aqui no Jardins", NÃO responda "Entendido, no Residencial Jardins das Oliveiras". Responda apenas "Entendido, no Jardins" ou de forma neutra.
- NÃO confirme o nome do usuário ("Ah, então você é o Sr. Fulano") a menos que ele tenha acabado de se apresentar formalmente.

REGRAS DE FORMATO - MUITO IMPORTANTE:
- NUNCA exiba JSON, código, ou dados estruturados na sua resposta ao cliente.
- Se precisar usar a ferramenta create_protocol, apenas CHAME a ferramenta silenciosamente - NÃO mostre os parâmetros na mensagem.
- Sua resposta ao cliente deve ser sempre texto natural em português, variando saudações e encerramentos para não parecer robótico.
- Use emojis de forma moderada e natural, como em uma conversa de WhatsApp.
`;


    const { data: providerConfig } = await supabase
      .from('ai_provider_configs')
      .select('*')
      .eq('active', true)
      .limit(1)
      .single();

    if (!providerConfig) throw new Error('Nenhum provedor de IA ativo configurado');
    const provider = providerConfig as any;

    const apiKey = Deno.env.get(provider.key_ref || (provider.provider === 'lovable' ? 'LOVABLE_API_KEY' : ''));
    if (!apiKey) throw new Error(`Chave de API não encontrada para ${provider.provider}`);

    // Tool definition (using create_protocol as name to avoid confusion)
    const protocolTool = [{
      type: "function",
      function: {
        name: "create_protocol",
        description: `REGRAS OBRIGATÓRIAS ANTES DE USAR ESTA FERRAMENTA:
1. NÃO usar na primeira mensagem do cliente
2. PRIMEIRO fazer perguntas de triagem para entender o problema
3. SÓ chamar após ter TODOS os dados: nome do condomínio + descrição clara do problema + nome do solicitante + apartamento (se for problema de unidade)
4. Se faltar qualquer dado, perguntar ao cliente ANTES de chamar esta ferramenta
5. Seguir o fluxo: saudação → entender problema → testes rápidos → coletar dados → só então registrar`,
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "O problema detalhado" },
            category: {
              type: "string",
              enum: ["operational", "support", "financial", "admin"],
              description: "Categoria do chamado. 'operational' para problemas técnicos."
            },
            priority: { type: "string", enum: ["normal", "critical"] },
            apartment: { type: "string", description: "Apartamento (se souber)" }
          },
          required: ["summary", "category"]
        }
      }
    }];

    let response: Response;
    if (provider.provider === 'lovable' || provider.provider === 'openai') {
      response = await fetch(
        provider.provider === 'lovable' ? 'https://ai.gateway.lovable.dev/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: 'system', content: cleanPrompt }, ...messagesNoSystem],
            tools: pf ? [] : protocolTool,
            tool_choice: pf ? 'none' : 'auto',
            temperature: Number(provider.temperature) || 0.7
          })
        }
      );
    } else if (provider.provider === 'gemini') {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${apiKey}`;
      response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: cleanPrompt }] },
          contents: messagesNoSystem.map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          ...(pf ? {} : { tools: [{ functionDeclarations: [protocolTool[0].function] }] }),
          toolConfig: { functionCallingConfig: { mode: pf ? "NONE" : "AUTO" } },
          generationConfig: { temperature: Number(provider.temperature) || 0.7 }
        })
      });
    } else { throw new Error(`Provedor não suportado: ${provider.provider}`); }

    if (!response.ok) throw new Error(`Erro da API de IA: ${await response.text()}`);
    const responseData = await response.json();

    let generatedText = '';
    let functionCall: any = null;
    let tokensIn = 0;
    let tokensOut = 0;

    if (provider.provider === 'gemini') {
      const candidate = responseData.candidates?.[0];
      const part = candidate?.content?.parts?.find((p: any) => p.functionCall);
      if (part) {
        functionCall = { name: part.functionCall.name, args: part.functionCall.args };
      } else {
        generatedText = candidate?.content?.parts?.[0]?.text || '';
      }
      tokensIn = responseData.usageMetadata?.promptTokenCount || 0;
      tokensOut = responseData.usageMetadata?.candidatesTokenCount || 0;
    } else {
      const msg = responseData.choices?.[0]?.message;
      if (msg?.tool_calls?.length) {
        functionCall = {
          name: msg.tool_calls[0].function.name,
          args: JSON.parse(msg.tool_calls[0].function.arguments)
        };
      } else {
        generatedText = msg?.content || '';
      }
      tokensIn = responseData.usage?.prompt_tokens || 0;
      tokensOut = responseData.usage?.completion_tokens || 0;
    }

    // --- FALLBACK INTENT DETECTION ---
    // ✅ FIX: DESATIVADO - Este fallback força abertura indesejada
    // A IA deve chamar a tool explicitamente via tool_call, não por regex no texto
    const aiSaidWillRegister = /vou registrar|vou abrir|vou encaminhar|registrei/i.test(generatedText);
    if (!pf && !functionCall && aiSaidWillRegister) {
      // ✅ APENAS LOG - NÃO forçar abertura
      console.log('[AI] 📝 Intent detected in text but NOT forcing protocol. AI should use tool_call explicitly.');
    }

    // Implementation of Tool call (if triggered by AI or Fallback)
    if (functionCall && (functionCall.name === 'create_protocol' || functionCall.name === 'create_ticket')) {
      try {
        const ticketData = await executeCreateProtocol(supabase, supabaseUrl, supabaseServiceKey, conversationId!, participant_id, functionCall.args);

        const protocol = ticketData.protocol || ticketData;
        const nowBr = new Date().toLocaleString("pt-BR", { timeZone: "America/Recife" });

        // Humanized conversational confirmation
        const catLabel = translateCategory(protocol.category);
        const code = protocol.protocol_code || protocol.code || protocol.protocol_number || protocol.id;
        const officialCode = code.startsWith("G7-") ? code : `G7-${code}`;

        const RESPONSES = [
          `Tudo certo! Acabei de registrar seu chamado técnico aqui com o protocolo **${officialCode}**. Já informei nossa equipe técnica e estamos acompanhando por aqui.`,
          `Perfeito, já protocolei seu pedido como **${officialCode}** (categoria ${catLabel}). Nossa equipe operacional já foi avisada e vamos cuidar disso o quanto antes.`,
          `Entendido. Registrei aqui o chamado sob o protocolo **${officialCode}**. Já direcionei para o time responsável e qualquer novidade te aviso por aqui mesmo!`,
          `Combinado. Seu protocolo é o **${officialCode}**. Já deixei tudo pronto com a nossa equipe técnica para verificarem essa questão.`
        ];

        // Choose variation deterministic
        let h = 0; const seed = `${conversationId}:${officialCode}`;
        for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
        generatedText = RESPONSES[h % RESPONSES.length];

        if (!hasCondoInfo) {
          generatedText += "\n\nPra agilizar, me diga o condomínio quando puder (pode ser só o nome mesmo).";
        }
      } catch (e) {
        console.error('Tool call failed:', e);
        console.error('Tool call error details:', {
          conversationId,
          functionCall,
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined
        });

        // ✅ Se faltou condomínio/apto, transforma em "pendente" e pergunta 1 coisa
        if (isMissingCondoError(e)) {
          if (conversationId) {
            await setPending(conversationId, 'condominium_name', supabase, { last_summary: functionCall.args?.summary || null });
          }
          generatedText = "Gostaria de registrar seu chamado, mas poderia me confirmar o nome do condomínio primeiro, por favor?";
        } else if (isMissingAptError(e)) {
          if (conversationId) {
            await setPending(conversationId, 'apartment', supabase, { last_summary: functionCall.args?.summary || null });
          }
          generatedText = "Registrei o problema, mas poderia me informar o número do seu apartamento ou unidade para concluir?";
        } else {
          // ✅ Erro genérico: não prometer contato; pedir retry simples
          if (conversationId) {
            await setPending(conversationId, 'retry_protocol', supabase, {
              last_summary: functionCall.args?.summary || null,
              last_priority: functionCall.args?.priority || null,
              last_apartment: functionCall.args?.apartment || null,
              last_error: String((e as any)?.message || e).slice(0, 500),
            });
          }
          generatedText = "Sinto muito, tive um erro técnico para registrar o chamado agora. Você poderia confirmar o problema brevemente para que eu tente novamente?";
        }
      }
    }

    // ✅ FALLBACK: If LLM returned empty text and we have a pending field, use fallback text
    if (!generatedText.trim()) {
      console.warn(`[AI] LLM returned empty text, pf=${pf}. Using fallback.`);
      generatedText = fallbackQuestionForPending(pf);
    }

    // ✅ ANTI-REPETITION: Bloquear envio da mesma mensagem em janela de tempo (1h)
    const norm = (s?: string | null) => (s ?? "").trim();

    const { data: lastAiOut } = await supabase
      .from("messages")
      .select("content, sent_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .eq("sender_type", "assistant")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastAiOut && norm(lastAiOut.content) === norm(generatedText)) {
      const ms = Date.now() - new Date(lastAiOut.sent_at).getTime();
      if (ms < 60 * 60 * 1000) { // 1 hour window
        console.log("[AI] Skipping duplicate assistant message (anti-loop).");
        return new Response(JSON.stringify({ text: null, skipped: "duplicate_ai_message" }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    let finalText = generatedText;
    if (greeting && !generatedText.includes("registrado com sucesso") && !generatedText.includes("Seu chamado foi registrado")) {
      finalText = greeting + generatedText;
    }

    return new Response(JSON.stringify({
      text: finalText,
      provider: provider.provider,
      model: provider.model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: Date.now() - startTime,
      request_id: crypto.randomUUID()
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('AI Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  } finally {
    // ✅ LIBERAR LOCK
    if (cid) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase.from('ai_conversation_locks').delete().eq('conversation_id', cid);
        console.log('[AI] 🔓 Lock released:', cid);
      } catch (e: any) {
        // Silencioso se for erro de tabela inexistente
        if (!e.message?.includes('ai_conversation_locks')) {
          console.error('[AI] ❌ Error releasing lock:', e.message);
        }
      }
    }
  }
});
