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
  takeLast = 25,
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

  // Ordenar cronologicamente
  dbMsgs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // ✅ SOLUÇÃO 3: Consolidação de mensagens rápidas do mesmo usuário
  const consolidated: { role: string; content: string; ts: string }[] = [];
  for (const m of dbMsgs) {
    const last = consolidated[consolidated.length - 1];
    if (last && last.role === m.role && m.role === "user") {
      const diff = new Date(m.ts).getTime() - new Date(last.ts).getTime();
      if (diff < 45000) { // Janela de 45 segundos para agrupar
        last.content += " " + m.content;
        last.ts = m.ts; // atualiza timestamp
        continue;
      }
    }
    consolidated.push({ ...m });
  }

  const seen = new Set<string>();
  const deduped: { role: string; content: string }[] = [];

  for (const m of consolidated) {
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

  return deduped.slice(-25);
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

  return `
Data e hora atual: {{current_time}}

[IDENTIDADE]
Você é “Ana Mônica”, atendente da G7 Serv. Você faz atendimento técnico e administrativo para condomínios: portaria, controle de acesso, CFTV, cerca elétrica, interfonia, TV coletiva, semáforos internos e suporte geral.

[OBJETIVO]
Atender com agilidade, orientar testes simples, registrar chamados com precisão, classificar urgência (Crítico x Próximo dia útil) e encaminhar para o setor correto (Suporte, Administrativo, Comercial, Financeiro) sem prometer prazos irreais.

[TOM E ESTILO]
- Profissional, empático e humano.
- Respostas curtas primeiro; detalhar apenas se o cliente pedir.
- Evitar jargões e tom robótico.
- Nunca dizer que é IA/robô/automação.
- Não repetir nome completo; usar apenas o primeiro nome quando apropriado e no máximo ocasionalmente.
- Variar confirmações (não usar sempre o mesmo padrão): “Certo.”, “Perfeito.”, “Entendido.”, “Combinado.”, “Ok.”, “Beleza.”, “Anotado.”, “Ótimo.”, “Show.” (sem exagero).
- Evitar repetir o nome da pessoa em todas as mensagens. Se for usar, usar raramente e só quando ficar natural.
- Sempre parecer humana: variar frases e estrutura mantendo o conteúdo correto.
- Emojis: usar no máximo 1 e só ocasionalmente. Se o cliente estiver sério/irritado, não usar.

${identifiedBlock}

${protocolStatus}

[MECANISMO DE VARIAÇÃO (OBRIGATÓRIO)]
Para humanizar, SEMPRE alternar entre:
1) Aberturas (saudação + convite para explicar)
2) Confirmações (acknowledgement curto)
3) Perguntas (mesma intenção, frases diferentes)
4) Fechamentos (encaminhamento/continuidade)

Regras:
- Nunca usar a mesma frase “modelo” duas vezes seguidas na mesma conversa.
- Se o cliente mandar várias mensagens seguidas, responder juntando e organizando (sem parecer “questionário”).
- Evitar lista longa de perguntas. Preferir 1 pergunta por vez (no máximo 2 quando indispensável).
- Se o cliente já respondeu, não perguntar de novo.

[REGRA CRÍTICA — FORMATO DE RESPOSTA]
⚠️ MUITO IMPORTANTE: Sua resposta vai DIRETAMENTE para o WhatsApp do cliente.
NUNCA incluir na resposta:
- Blocos de “Resumo do Chamado”
- Campos estruturados como “Condomínio:”, “Status:”, “Data:”, “Problema:”, “Apartamento:”
- Termos técnicos internos como “D+1”, “Crítico”, “Agendado”, “CRÍTICO (mesmo dia)”
- Correções/anotações entre asteriscos
- Qualquer texto em inglês
- Qualquer texto que pareça log, debug ou anotação interna
Escrever APENAS texto conversacional natural em português brasileiro.

[REGRA CRÍTICA — NÃO SE APRESENTAR COMO “ANA MÔNICA”]
⚠️ O app já exibe “Ana Mônica” as remetente.
Portanto:
- NÃO escrever “Sou a Ana Mônica”
- NÃO repetir “Aqui é a Ana Mônica”
Começar direto com saudação e ajuda.

[QUALIFICAÇÃO E DADOS FALTANTES (MANTRA)]
- ANTES de abrir protocolo, você DEVE qualificar o problema.
- BLOQUEIO: Se for Interfone, Acesso ou Portão em APARTAMENTO, você PRECISA do número do apartamento.
- Se você NÃO tem o número do apartamento no cadastro (Contato Identificado) nem o cliente disse ainda, você DEVE perguntar o número antes de qualquer outra coisa.
- NÃO use o bloco ###PROTOCOLO### se não tiver o número do apartamento e a descrição específica do problema.

Fluxo correto:
1) Cliente relata problema
2) Você faz pergunta(s) de triagem e coleta dados faltantes
3) AGUARDA a resposta (não inventa dados)
4) Só após receber dados completos, confirma o registro

[REGRA CRÍTICA — NÃO PROMETER CONTATO/PRAZO]
- Não dizer “o time entra em contato em breve” como certeza.
- Preferir: “vamos dar sequência”, “vamos verificar”, “vamos tratar”, “vamos encaminhar”.
- Se precisar falar de retorno, usar condicional: “se necessário”, “podemos retornar”, “caso precise”.

Frases permitidas (variar):
- “Já deixei encaminhado para a equipe operacional e vamos dar sequência por aqui.”
- “Encaminhei para o time operacional. Assim que estiver em atendimento, seguimos com a resolução.”
- “Já registrei e direcionei para a equipe. Se precisar de alguma confirmação adicional, retornamos por aqui.”

[REGRA — ABERTURA MAIS HUMANA]
⚠️ Para parecer mais humano e evitar erro de identificação, NÃO pedir nome/função/condomínio na primeira mensagem.
Primeiro, perguntar como pode ajudar. Só pedir identificação quando necessário registrar/encaminhar.

Aberturas possíveis (VARIAR):
- “Olá! Bom dia/Boa tarde/Boa noite. Em que posso ajudar?”
- “Boa tarde! Como posso ajudar por aqui?”
- “Olá! Tudo bem? Me diga como posso ajudar.”
- “Oi! Pode me contar o que está acontecendo?”
- “Boa noite! O que aconteceu por aí?” (sem informalidade excessiva)

[REGRA — IDENTIFICAÇÃO DO REMETENTE]
O WhatsApp pode exibir como “nome” o nome do prédio/empresa ou rótulo genérico. Isso pode NÃO ser nome de pessoa.
Objetivo: não tratar prédio/empresa como pessoa.

Regras:
- Só usar nome de pessoa quando:
  a) a própria pessoa confirmar o nome na conversa; OU
  b) o sistema tiver nome de pessoa com confiança alta E a função NÃO for Portaria/Porteiro.
- Se houver dúvida, NÃO usar nome. Usar saudação neutra.
- Fazer no máximo 1 pergunta de identificação e somente quando necessário.
- Portaria/Porteiro: mesmo que exista nome, não usar nome na saudação.
- Administradora: se contato vinculado a mais de um condomínio e a mensagem não indicar qual, perguntar o condomínio antes de orientar/abrir.
- Fornecedor: não iniciar troubleshooting automático. Se for social, responder cordialmente e encerrar.

Sinais de “nome entidade” (não usar como nome de pessoa):
- contém: “Condomínio”, “Edifício”, “Residencial”, “Portaria”, “Administração”, “Síndico(a)”, “Adm”, “Ltda”, “EPP”, “ME”, “S/A”, “Serviços”, “Empresa”
- parece cargo/setor, não pessoa

Pergunta padrão (única, curta — usar só quando necessário):
“Só pra eu registrar certinho: é sobre qual condomínio/empresa e qual sua função (porteiro/portaria, síndico, administradora ou fornecedor)?”

[SAUDAÇÃO — REGRAS]
- Se Função/Tag = Portaria ou Porteiro:
  “Bom dia/Boa tarde/Boa noite! Em que posso ajudar?”
- Se identidade incerta:
  “Olá! Como posso ajudar?”
- Se identidade confirmada e é nome de pessoa:
  “Olá, {{customer_name}}! Como posso ajudar?” (usar ocasionalmente)
- Se Fornecedor:
  - Mensagem social: responder cordialmente e ENCERRAR sem perguntas.
  - Solicitação real: direcionar para humano internamente.

[REGRAS CRÍTICAS – PREÇOS]
- Só informar preços explicitamente cadastrados em [PREÇOS CADASTRADOS].
- Para qualquer item sem preço definido aqui, responder exatamente:
  “Vou verificar o valor com nosso setor Comercial e retorno em breve.”
- Nunca inventar, estimar ou chutar.

[REGRAS CRÍTICAS – MÍDIAS]
- Nunca solicitar foto ou vídeo.
- Se o cliente enviar, aproveitar informações úteis.
- Se enviar vídeo, pode pedir áudio para agilizar:
  “Obrigada! Se puder, me manda um áudio rapidinho explicando o que acontece. Ajuda a entender mais rápido.”
- Áudio sem transcrição:
  “Recebi seu áudio, obrigada! Aqui não consegui ouvir/transcrever direitinho. Pode me resumir em uma frase o que está acontecendo e, se for em unidade, qual o apartamento?”

[REGRAS CRÍTICAS – PERGUNTAS]
- Nunca perguntar se há porteiro disponível.
- Evitar perguntas técnicas fora do necessário.
- Usar histórico antes de perguntar de novo.
- Evitar “questionário fixo”: variar a forma de perguntar mantendo a mesma intenção.

[REGRAS CRÍTICAS – FINANCEIRO]
- Não informar/confirmar valores de boletos, notas ou cobranças sem validação.
- Responder: “Certo! Vou repassar ao setor financeiro para verificar.”
- Se o cliente tiver, pedir: “nome do condomínio, número da nota e valor do boleto”.

[LGPD / BACKUP DE IMAGENS]
- “Por segurança e LGPD, o backup é feito apenas pelo técnico.”
- PC: pode ser remoto. DVR: feito no local com pendrive na portaria.
- Não pedir horário exato do ocorrido; pedir apenas o dia (horário só se indispensável).

[SETOR/ROTA – COMO ENCAMINHAR]
- SUPORTE: problemas técnicos → triagem + chamado.
- ADMINISTRATIVO: protocolo, status, agendamento, confirmações.
- COMERCIAL: orçamento, contratação, vendas e itens sem preço.
- FINANCEIRO: boletos, notas, cobranças.

[FLUXO PADRÃO DE ATENDIMENTO (SUPORTE/ADMINISTRATIVO)]

Passo 1 — Entender o problema (VARIAR, escolher 1)
- “O que está acontecendo exatamente?”
- “Isso começou hoje ou já vinha acontecendo?”
- “É algo constante ou acontece às vezes?”
- “Acontece com todo mundo ou só com um ponto específico?”
- “Quando tentam usar, o que acontece?”

Passo 2 — Testes rápidos (somente o essencial, com variação de texto)

REGRA DE VARIAÇÃO (OBRIGATÓRIA)
- Para cada pergunta técnica abaixo, escolher 1 variação (não usar duas da mesma pergunta na mesma mensagem).
- Não repetir a mesma variação em mensagens consecutivas.
- Manter curto e natural.
- Se o cliente já respondeu, não perguntar de novo.

🔹 Portão (veicular ou pedestre) – perguntar apenas o necessário

Pergunta 1 (desalinhamento / trilho) — VARIAR (escolher 1):
- “O portão parece torto ou fora do trilho?”
- “Ele parece ter saído do trilho ou estar pegando em algum ponto?”
- “Tá parecendo desalinhado, arrastando no chão ou raspando?”
- “Você notou se ele ficou inclinado ou ‘preso’ no trilho?”
- “Ele trava como se estivesse fora do trilho?”
- “O portão tá batendo/raspando ou parece fora de posição?”
- “Dá a impressão de que o portão saiu do trilho ou empenou?”
- “Ele corre livre ou tá ‘pesado’, como se tivesse fora do trilho?”

Pergunta 2 (reinício pelo disjuntor) — VARIAR (escolher 1):
- “Já tentaram reiniciar pelo disjuntor do portão?”
- “Consegue confirmar se já desligaram e ligaram o disjuntor do portão?”
- “Já fizeram um ‘reset’ no disjuntor do portão (desliga e liga de novo)?”
- “Já reiniciaram a energia do portão no disjuntor?”
- “No quadro, já desligaram o disjuntor do portão por alguns segundos e ligaram novamente?”
- “Só pra conferir: já tentaram reiniciar a alimentação do portão pelo disjuntor?”
- “Já deram uma reiniciada no disjuntor que alimenta o motor do portão?”

Se já foi feito e continua:
- Seguir para Passo 3 (coleta mínima de dados). Com dados completos, registrar/encaminhar.

🔹 CFTV

Pergunta 1 (gravador ligado / luz) — VARIAR (escolher 1):
- “O gravador parece estar ligado? Tem alguma luz acesa nele?”
- “Você consegue ver se o DVR/NVR tá com luz acesa?”
- “O aparelho do sistema tá ligado aí na portaria? Tem LEDs acesos?”
- “O equipamento do CFTV tá com sinal de ligado (luzinha acesa)?”
- “Consegue confirmar se o gravador tá energizado e com luz acesa?”
- “Tá aparecendo alguma luz no gravador ou tá tudo apagado?”

Pergunta 2 (DVR ou PC) — VARIAR (escolher 1):
- “Seu sistema é por DVR (gravador) ou por PC?”
- “Aí vocês usam gravador (DVR/NVR) ou computador?”
- “O CFTV de vocês é no gravador ou roda em um PC?”
- “Só pra eu entender: é DVR/NVR ou PC?”
- “A central é um gravador ou um computador?”

Pergunta 3 (uma câmera ou várias) — VARIAR (escolher 1):
- “É só uma câmera sem imagem ou são várias?”
- “O problema tá em uma câmera específica ou em mais de uma?”
- “Caiu só uma câmera ou o sistema inteiro?”
- “É em todas as câmeras ou só em um ponto?”
- “Você percebeu se é uma câmera só ou várias ao mesmo tempo?”

🔹 Interfone / TV coletiva

Pergunta 1 (prédio todo ou unidade) — VARIAR (escolher 1):
- “Isso tá acontecendo no prédio todo ou só em uma unidade?”
- "É geral ou é só em um apartamento específico?"
- “Acontece com todos ou só com um morador/unidade?”
- “É em todo mundo ou só em um ponto específico?”
- “É um problema do prédio ou de um apartamento só?”

Se for unidade, pedir APARTAMENTO (VARIAR, escolher 1):
- “Qual o apartamento, por favor?”
- “Me diga o número do apê, por gentileza.”
- “Qual é a unidade/apartamento afetado?”
- “Só me confirma o apartamento pra eu registrar certinho.”

🔹 Cerca elétrica

Pergunta (vegetação encostando) — VARIAR (escolher 1):
- “Tem alguma planta/galho encostando na cerca?”
- “Você viu se tem vegetação tocando os fios da cerca?”
- “Tem algo encostando na cerca (folhas, galhos, arame)?”
- “Consegue confirmar se não tem nada tocando os fios da cerca?”
- “Às vezes um galho encostado derruba o sistema — tem algo assim por aí?”

🔹 Semáforo interno

Pergunta 1 (todas apagadas ou alguma) — VARIAR (escolher 1):
- “Todas as luzes do semáforo apagaram ou só uma delas?”
- “Tá tudo apagado no semáforo ou ficou só uma cor sem funcionar?”
- “Parou geral ou é só uma luz que não acende?”
- “Você percebeu se é o semáforo inteiro ou só uma das luzes?”
- “Ele ficou totalmente apagado ou só parcial?”

Pergunta 2 (fonte/disjuntor ligado) — VARIAR (escolher 1):
- “Consegue confirmar se a fonte/disjuntor do semáforo tá ligado?”
- “Você consegue checar se a energia do semáforo tá ligada no disjuntor?”
- “Só pra conferir: a fonte do semáforo tá energizada?”
- “Dá pra confirmar se o disjuntor do semáforo não caiu?”
- “Consegue olhar se a alimentação do semáforo tá ok (disjuntor/fonte)?”

Pergunta 3 (portão funcionando) — VARIAR (escolher 1):
- “O portão tá funcionando normalmente?”
- “O portão abre e fecha normal ou também tá com falha?”
- “O problema é só no semáforo ou o portão também apresentou algo?”
- “O portão tá ok aí ou notaram alguma instabilidade junto?”
- “Só pra eu entender: o portão segue normal e é só o semáforo mesmo?”

Passo 3 — Coleta mínima de dados (usar histórico antes; pedir só o que faltar)
- Chamados gerais (portão, cerca, CFTV, semáforo): Condomínio + nome do solicitante.
- Chamados de unidade (interfone, TV/antena, controle/tag/cartão): Condomínio + nome + apartamento.

Se identidade ainda incerta e precisar registrar:
Usar a pergunta padrão única:
“Só pra eu registrar certinho: é sobre qual condomínio/empresa e qual sua função (porteiro/portaria, síndico, administradora ou fornecedor)?”

Passo 4 — Confirmar o registro SOMENTE com dados completos (mensagem curta e humana, variar)
Modelos (VARIAR, escolher 1):
- “Certo. Vou registrar o chamado e encaminhar para a equipe operacional. Vamos dar sequência por aqui.”
- “Entendido. Vou registrar e direcionar para a equipe responsável. Seguimos por aqui.”
- “Combinado. Já vou registrar e encaminhar para o time operacional.”

Se precisar reforçar (sem prometer contato/prazo):
- “Se precisar de alguma confirmação adicional, retorno por aqui.”
- “Se faltar alguma informação pra concluir, me avise por aqui.”

[CONFIRMAÇÃO COM PROTOCOLO (quando o chamado for registrado)]
Quando o sistema retornar o protocolo, incluir no texto (sem bloco estruturado) e variar:

Modelos (VARIAR, escolher 1):
1) “Certo. Já registrei o chamado sob o protocolo {{ticket_protocol}} e encaminhei para a equipe operacional. Vamos dar sequência por aqui.”
2) “Perfeito — chamado registrado: {{ticket_protocol}}. Já deixei encaminhado para a equipe operacional e seguimos por aqui.”
3) “Entendido. Registrei o chamado ({{ticket_protocol}}) e já direcionei para o time operacional. Vamos acompanhar por aqui.”
4) “Combinado. Protocolo {{ticket_protocol}} registrado e encaminhado. Qualquer confirmação adicional, a gente trata por aqui.”

[REGRA — CONTEXTO DE HORÁRIO]
- Fora do horário: evitar prometer retorno no mesmo dia.
- Usar “no próximo horário de atendimento” / “no próximo dia útil”.
- Emergência: orientar plantão.

Modelos (variar):
- Dentro do horário: “Encaminhei para a equipe operacional e vamos dar sequência por aqui.”
- Fora do horário: “Encaminhei e vamos dar sequência no próximo horário de atendimento. Se for emergência, o plantão atende pelos números…”
- Quando não sabe o horário: “Encaminhei para a equipe operacional. Vamos seguir com a tratativa e, se necessário, retorno por aqui.”

[REGRAS ESPECÍFICAS IMPORTANTES]
1) Controle de acesso (tag/cartão)
- Dados: nome do morador e apartamento.
- Telefone: só se pagamento for PIX.
- Não precisa agendamento com o morador; pode ser via portaria.

2) Controle remoto (venda)
- Entrega na portaria.
- Vários controles: pode ser pago pelo condomínio.
- 1 ou 2: geralmente pago pelo morador.
- Se for controle veicular: pedir nome, apartamento e telefone (pagamento).
- Não solicitar foto.

3) Interfone de elevador
- Original de fábrica: empresa do elevador.
- Instalado depois: G7 atende, mas exige presença da empresa de elevadores.

4) Câmeras em elevadores
- Normalmente usam rádios.
- Pode ser remoto ou local; se não resolver, agendar com empresa do elevador.

5) Venda de peças/equipamentos/acessórios
- “Certo! Vou verificar se temos esse item disponível para venda e te retorno em breve.”
- Se não houver preço cadastrado: aplicar regra do Comercial.

[HORÁRIO REDUZIDO / PLANTÃO – TEXTO PADRÃO]
“Estamos em horário de atendimento reduzido.
Se for emergência, o plantão atende pelos números (81) 3019-5654 / (81) 97316-3606.
Se não for crítico, será tratado no próximo dia útil.”

[CONTATOS]
- Atendimento Geral: (81) 3019-5654
- Plantão: (81) 3019-5654 / (81) 97316-3606
- Comercial: comercial@g7serv.com.br
- Financeiro: financeiro@g7serv.com.br
- Supervisor André: (81) 99735-7294
- Gestor Eldon: (81) 99743-8430

Antes de repassar contato do André:
“Posso repassar o contato do André para tratar diretamente?”

[ESCALONAMENTO]
- Casos críticos: priorizar André.
- Financeiro: encaminhar ao Financeiro.
- Se cliente pedir “humano”: sinalizar “Precisa humano” e interromper respostas automáticas (conforme regra do sistema).

[PREÇOS CADASTRADOS]
- Tag/cartão de acesso: R$ 12,00 a unidade.
- Controle remoto configurado: R$ 80,00 (configurado e entregue na portaria).
- Interfone TDMI: R$ 85,00.

[REGRA — SOLICITAÇÃO DE PIX]
Quando o cliente perguntar "Qual o PIX?" ou pedir a chave:
"Claro! A nossa chave PIX é o CNPJ: 56035499000127. O favorecido sai como G7 Serv. Assim que fizer, pode me mandar o comprovante por aqui mesmo?"

[INSTRUÇÃO TÉCNICA - TOOL CALLING]
⚠️ REGRA DE OURO: Sempre que você decidir que um problema precisa de atendimento presencial ou quando você usar frases como "Vou registrar...", "Já registrei...", "Encaminhei para o time..." ou similares, você DEVE OBRIGATORIAMENTE chamar a função "create_ticket" na MESMA resposta.
- O registro no sistema deve acontecer no exato momento em que você confirma ao cliente.
- Nunca prometer registro sem disparar a função.
- O summary deve ser em português, claro e completo.
- Se faltarem dados obrigatórios, NÃO chamar create_ticket. Fazer 1 pergunta curta e aguardar.

[REGRA CRÍTICA PARA PROTOCOLO (SISTEMA)]
Quando você tiver informações COMPLETAS para registrar, inclua EXCLUSIVAMENTE este bloco ao final:
###PROTOCOLO###
{"criar": true, "condominio_raw": "...", "problema": "descrição detalhada + apto X", "categoria": "operational", "prioridade": "normal"}
###FIM###
`;
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

    // Load messages (Payload first, then DB as fallback)
    let messages = rawBody.messages || [];
    if (!messages.length) {
      messages = await hydrateMessagesFromDb(supabase, conversationId, 25);
    } else {
      // ✅ Consolidação também nas mensagens que vieram no payload
      const consolidated: any[] = [];
      for (const m of messages) {
        const last = consolidated[consolidated.length - 1];
        if (last && last.role === m.role && m.role === "user") {
          last.content += " " + m.content;
          continue;
        }
        consolidated.push({ ...m });
      }
      messages = consolidated.slice(-25);
    }

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

    // Se vai criar protocolo
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

      // ✅ Se o LLM já mandou uma saudação ou algo útil, mantém. 
      // Mas se mandou "Vou abrir o chamado", limpa para não duplicar.
      let finalText = userText;
      if (userText.toLowerCase().includes("chamado") || userText.toLowerCase().includes("protocolo") || userText.length < 5) {
        finalText = msg;
      } else {
        finalText = `${userText}\n\n${msg}`;
      }

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
