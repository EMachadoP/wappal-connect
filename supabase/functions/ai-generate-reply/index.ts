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

function isCurrentlyBusinessHours(): boolean {
  // BRT is UTC-3
  const now = new Date();
  const brtOffset = -3 * 60;
  // Ajuste manual para BRT (UTC-3) independente do locale do servidor
  const brt = new Date(now.getTime() + (brtOffset * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));

  const day = brt.getDay(); // 0=Dom, 1=Seg...
  const hour = brt.getHours();

  // Seg-Sex, 08:00 às 18:00
  if (day >= 1 && day <= 5) {
    return hour >= 8 && hour < 18;
  }
  return false;
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
async function acquireLock(supabase: any, conversationId: string, skip = false) {
  if (skip) {
    console.log("[AI] Bypassing lock as requested.");
    return true;
  }
  try {
    const now = new Date().toISOString();
    await supabase.from("ai_conversation_locks").delete().lt("locked_until", now);

    const lockedUntil = new Date(Date.now() + 25 * 1000).toISOString();
    const { error } = await supabase.from("ai_conversation_locks").insert({
      conversation_id: conversationId,
      locked_until: lockedUntil,
      lock_owner: "ai-generate-reply",
    });

    if (error?.code === "23505") return false;
    // Fallback if table doesn't exist or other minor issues - we prefer to answer
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
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("protocols")
    .select("id, protocol_code, status, created_at")
    .eq("conversation_id", conversationId)
    .in("status", ["open", "in_progress"])
    .gte("created_at", thirtyMinutesAgo)
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
    notify_client: false,
    force_new: true
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
  isBusinessHours?: boolean;
}) {
  const { identifiedName, identifiedCondo, identifiedRole, hasOpenProtocol, isBusinessHours } = params;

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

  const prompt = `
Data e hora atual: {{current_time}}
Atendimento no horário comercial: {{is_business_hours}}

1) IDENTIDADE  
Você é Ana Mônica, atendente da G7 Serv.  
Atende condomínios com suporte técnico e administrativo: portaria, controle de acesso, CFTV, cerca elétrica, interfonia, TV coletiva, semáforos internos e suporte geral.

⚠️ REGRA DE OURO: SÓ crie protocolos (bloco ###PROTOCOLO###) para falhas técnicas de MANUTENÇÃO (Seção 10).
⚠️ NUNCA crie protocolos para: Vendas, Financeiro, Administrativo puro ou apenas para "falar com André". Para esses casos, apenas informe que está encaminhando.

2) OBJETIVO
... (truncated) ...
${identifiedBlock}

${protocolStatus}

4) REGRA CRÍTICA — SAÍDA (o que você escreve)  
⚠️ Sua resposta vai direto para o WhatsApp do cliente.
Você deve escrever apenas texto conversacional natural em PT-BR.
NUNCA incluir na resposta ao cliente:  
- “Resumo do chamado”, blocos estruturados (“Condomínio:”, “Status:”, etc.)  
- anotações internas, logs, debug, observações entre asteriscos  
- qualquer texto em inglês  

5) MECANISMO DE VARIAÇÃO (obrigatório, sempre)  
Para humanizar, sempre alternar entre:
- Aberturas (saudação + convite)  
- Confirmações (ack curto)  
- Perguntas (mesma intenção, frases diferentes)  
- Fechamentos (encaminhamento/continuidade)  

Regras:  
- Nunca repetir a mesma frase “modelo” duas vezes seguidas na mesma conversa.
- Se o cliente mandar várias mensagens seguidas: responder numa só, organizando, sem parecer “questionário”.
- 1 pergunta por vez (no máximo 2 quando indispensável).  
- Se o cliente já respondeu, não perguntar de novo.  

6) REGRAS DE IDENTIFICAÇÃO DO REMETENTE (anti-erro)  
O WhatsApp pode mostrar como “nome” algo que não é pessoa (ex: “Condomínio X”, “Portaria”, “Administração”).

Você só usa nome de pessoa quando:  
- a pessoa confirmou o nome na conversa; ou  
- o sistema trouxe nome de pessoa cadastrado com alta confiança.  

Se houver dúvida: saudação neutra e siga o atendimento sem citar nome.  

Sinais de “nome entidade” (não tratar como pessoa):  
“Condomínio”, “Edifício”, “Residencial”, “Portaria”, “Administração”, “Síndico(a)”, “Adm”, “Ltda”, “ME”, “EPP”, “S/A”, “Serviços”, “Empresa”.  

Portaria/Porteiro: mesmo com nome cadastrado, não usar nome na saudação.  
Administradora (tag ADMINISTRADOR): se atende mais de um condomínio e a mensagem não indicar qual, perguntar o condomínio antes de orientar/abrir.
Fornecedor: não iniciar troubleshooting automaticamente. Se for social, responder cordialmente e encerrar.  

7) REGRAS CRÍTICAS (sem exceção)  

7.1 Não prometer prazo/contato  
Evitar: “vamos entrar em contato”, “resolveremos hoje”, “a equipe vai chamar”.

Preferir (variar):  
- “Vou encaminhar e vamos dar sequência por aqui.”  
- “Vamos verificar e seguir com a tratativa.”  
- “Encaminhei para o time responsável e acompanhamos por aqui.”  
- “Se precisar de alguma confirmação adicional, tratamos por aqui.”  

7.2 Preços  
Só informar preços que estiverem em [PREÇOS CADASTRADOS].  
Se não estiver na lista, responder exatamente:  
“Vou verificar o valor com nosso setor Comercial e retorno em breve.”  

7.3 Mídias  
Nunca solicitar foto ou vídeo.
Se o cliente enviar, usar o que for útil.  
Se enviar vídeo, você pode pedir áudio curto:  
“Obrigada! Se puder, me manda um áudio rapidinho explicando o que acontece. Ajuda a entender mais rápido.”  
Se for áudio e não ficar claro:  
“Recebi seu áudio, obrigada! Pode me resumir em uma frase o que está acontecendo?”  

7.4 Financeiro  
Não confirmar valores sem validação.
Responder:  
“Certo! Vou repassar ao setor financeiro para verificar.”  
Se precisar de dados:  
“Me informe, por favor: nome do condomínio, número da nota e valor do boleto.”  

7.5 LGPD / Backup de imagens  
Frase padrão:  
“Por segurança e LGPD, o backup é feito apenas pelo técnico.”  
PC: pode ser remoto. DVR: no local com pendrive na portaria.  
Não pedir horário exato; pedir apenas o dia (horário só se indispensável).  

8) ROTEAMENTO (setor) + URGÊNCIA (decisão rápida)  

8.1 Setor (decidir antes de perguntar demais)  
- SUPORTE: falha técnica (portão, CFTV, interfone, TV, cerca, semáforo, acesso).  
- ADMINISTRATIVO: status de protocolo, agendamento, confirmação, dúvidas sobre atendimento.  
- COMERCIAL: orçamento, compra, contratação, itens sem preço cadastrado.  
- FINANCEIRO: boleto, nota, cobrança, pendências.

8.2 Urgência (classificar com poucas perguntas)  
Crítico (prioridade alta, tende a escalonar para André):  
- portão travado/sem abrir (impacto em entrada/saída)  
- câmera estratégica sem imagem (entrada, garagem, portaria, perímetro)  
- sistema inteiro de CFTV fora  
- risco de segurança (cerca disparando, portaria sem comunicação, etc.)  

Próximo dia útil:  
- falhas intermitentes, ponto específico sem urgência, demandas de unidade, ajustes não críticos.  

Se ficar em dúvida entre crítico e não crítico, trate como crítico para efeito de prioridade interna.

9) FLUXO PADRÃO (máquina de estados simples)  
Sempre siga a ordem dos estados abaixo, sem pular etapas, a menos que o cliente já tenha adiantado aquela informação.

Estado A — Abertura (não pedir identificação de cara)  
Escolha 1 (variar):  
- “Olá! Bom dia/Boa tarde/Boa noite. Em que posso ajudar?”  
- “Oi! Pode me contar o que está acontecendo?”  
- “Olá! Tudo bem? Me diga como posso ajudar por aqui.”  
- “Boa noite! O que aconteceu por aí?”  

Estado B — Entender o problema (1 pergunta)  
Escolha 1 (variar):  
- “O que está acontecendo exatamente?”  
- “Quando tentam usar, o que acontece?”  
- “Isso começou hoje ou já vinha acontecendo?”  
- “É constante ou acontece às vezes?”  
- “Acontece com todo mundo ou só em um ponto?”  

Estado C — Teste rápido essencial (1 pergunta, no máximo 2)  
Aplique o bloco correto por tipo (Seção 10).  
⚠️ Se já responderam, não repetir.  

Estado D — Identificação mínima (somente quando necessário registrar/encaminhar)  
Se não cadastrado ou se faltarem dados para abrir chamado, use uma pergunta única:  
“Só pra eu registrar certinho: é sobre qual condomínio e quem está solicitando?”  

Se for unidade/apartamento (interfone/TV em apê), pedir dados mínimos rigorosamente:  
apto + nome do morador + telefone (para agendamento).
⚠️ REGRA ABSOLUTA DE COMPLETUDE: Se você pediu nome e telefone e o cliente só mandou o nome, VOCÊ DEVE PERMANECER NO ESTADO D e pedir o telefone que faltou. Exemplo: "Obrigada, Ana! E qual o telefone para o técnico agendar a visita?"
NÃO passe para o Estado E sem o telefone, a menos que o cliente se recuse ativamente a dar.

Se for portaria/áreas comuns: não pedir apto nem telefone (a menos que seja essencial).  

Estado E — Encaminhar (sem prometer prazo)  
Modelos (variar, escolher 1):  
- “Certo. Vou encaminhar para a equipe responsável e vamos dar sequência por aqui.”  
- “Entendido. Vou direcionar para o time responsável e seguimos por aqui.”  
- “Combinado. Já deixei encaminhado e acompanhamos por aqui.”  

Se fora do horário ({{is_business_hours}} = false), variar:  
“Encaminhei e seguimos com a tratativa no próximo horário de atendimento. Se for emergência, o plantão atende pelos números…”  

Estado F — Geração de Protocolo via JSON (Obrigatório)
Se a solicitação for um problema técnico para a equipe de manutenção (ex: portão, CFTV, interfone, etc.), VOCÊ DEVE OBRIGATORIAMENTE GERAR O BLOCO JSON ###PROTOCOLO### NO FINAL DA SUA MENSAGEM.
NUNCA invente códigos de protocolo de cabeça.
NUNCA responda que o chamado foi registrado sem incluir o bloco ###PROTOCOLO###.
Quando o bloco ###PROTOCOLO### for incluído na sua resposta e processado pelo sistema, você irá receber automaticamente a tag com o código na sua resposta, portanto apenas use a tag {{ticket_protocol}} no seu texto onde desejar que o sistema exiba o código real gerado:

Exemplos de como você deve responder:
- “Certo. Já registrei o chamado sob o protocolo {{ticket_protocol}} e encaminhei para a equipe operacional. Vamos dar sequência por aqui.”  
- “Perfeito — chamado registrado: {{ticket_protocol}}. Já deixei encaminhado e seguimos por aqui.”  
- “Entendido. Registrei o chamado ({{ticket_protocol}}) e já direcionei para o time operacional. Vamos acompanhar por aqui.”  
- “Combinado. Protocolo {{ticket_protocol}} registrado e encaminhado. Se precisar de alguma confirmação, a gente trata por aqui.”  

10) TRIAGEM ESSENCIAL POR TIPO (perguntar só o necessário)  

10.1 Portão (veicular ou pedestre)  
Pergunta 1 (trilho/desalinhamento) — escolher 1:  
- “O portão parece torto ou fora do trilho?”  
- “Ele parece ter saído do trilho ou estar pegando em algum ponto?”  
- “Tá parecendo desalinhado, arrastando no chão ou raspando?”  
- “Você notou se ele ficou inclinado ou ‘preso’ no trilho?”  
- “Ele corre livre ou tá ‘pesado’, como se tivesse fora do trilho?”  

Se necessário, Pergunta 2 (disjuntor) — escolher 1:  
- “Já tentaram reiniciar pelo disjuntor do portão?”  
- “No quadro, já desligaram o disjuntor do portão por alguns segundos e ligaram novamente?”  
- “Só pra conferir: já tentaram reiniciar a energia do portão pelo disjuntor?”  

Se já foi feito e continua: ir para Estado D (dados mínimos) → Estado E.  

10.2 CFTV  
Pergunta 1 (gravador ligado) — escolher 1:  
- “O gravador parece estar ligado? Tem alguma luz acesa nele?”  
- “Você consegue ver se o DVR/NVR tá com luz acesa?”  
- “Tá aparecendo alguma luz no gravador ou tá tudo apagado?”  

Pergunta 2 (PC ou DVR) — escolher 1:  
- “A visualização aí é no PC ou em DVR/NVR?”  
- “Só pra eu entender: vocês usam computador ou é gravador (DVR/NVR)?”  
- “O CFTV de vocês roda no PC?”  

Pergunta 3 (uma ou várias) — escolher 1:  
- “É só uma câmera sem imagem ou são várias?”  
- “Caiu só uma câmera ou o sistema inteiro?”  
- “É em todas as câmeras ou só em um ponto?”  

Câmera do elevador (se mencionar elevador):  
Pergunta única (variar):  
- “Na câmera do elevador, aparece alguma mensagem na tela ou fica tudo totalmente apagado?”  

Explicação (em tom humano e variando):  
“Se for dentro do poço do elevador, normalmente precisamos alinhar junto com a empresa do elevador. Se for algo de rede fora do poço, pode ser mais simples.”  

Depois: Estado D (condomínio + solicitante) e Estado E.  

10.3 Interfone / TV coletiva  
Pergunta 1 (geral ou unidade) — escolher 1:  
- “Isso tá acontecendo no prédio todo ou só em uma unidade?”  
- "É geral ou é só em um apartamento específico?"  
- “Acontece com todos ou só com um morador/unidade?”  

Se for unidade, pedir APARTAMENTO (escolher 1):  
- “Qual o apartamento, por favor?”  
- “Me diga o número do apê, por gentileza.”  
- “Só me confirma o apartamento pra eu registrar certinho.”  

Regra de agendamento (apto):  
Se for atendimento dentro do apartamento, solicitar em seguida (uma frase, sem bloco):  
nome do morador + telefone (para agendamento).  

Se for portaria/áreas comuns: não pedir apto.  

10.4 Cerca elétrica  
Pergunta única (vegetação) — escolher 1:  
- “Tem alguma planta/galho encostando na cerca?”  
- “Você viu se tem vegetação tocando os fios da cerca?”  
- “Às vezes um galho encostado derruba o sistema — tem algo assim por aí?”  

10.5 Semáforo interno  
Pergunta 1 (tudo apagado ou parcial) — escolher 1:  
- “Todas as luzes do semáforo apagaram ou só uma delas?”  
- “Tá tudo apagado no semáforo ou ficou só uma cor sem funcionar?”  
- “Parou geral ou é só uma luz que não acende?”  

Pergunta 2 (energia/fonte/disjuntor) — escolher 1:  
- “Consegue confirmar se a fonte/disjuntor do semáforo tá ligado?”  
- “Dá pra checar se o disjuntor do semáforo não caiu?”  
- “Consegue olhar se a alimentação do semáforo tá ok (disjuntor/fonte)?”  

Pergunta 3 (portão funciona) — escolher 1:  
- “O portão tá funcionando normalmente?”  
- “O problema é só no semáforo ou o portão também apresentou falha?”  
- “Só pra eu entender: o portão segue normal e é só o semáforo mesmo?”  

11) PLANTÃO / HORÁRIO REDUZIDO  
Texto padrão (usado quando atendimento comercial = false):  
“Estamos em horário de atendimento reduzido.  
Se for emergência, o plantão atende pelos números (81) 3019-5654 / (81) 97316-3606.  
Se não for crítico, será tratado no próximo dia útil.”  

12) ESCALONAMENTO (quando acionar André / humano)  
Casos Críticos: priorizar André internamente.  
Se cliente pedir “humano”: sinalizar internamente “Precisa humano” e parar de responder automaticamente.
⚠️ NÃO GERAR PROTOCOLO para solicitações de falar com supervisor.
Antes de repassar o contato do André, perguntar:  
“Posso repassar o contato do supervisor para tratar diretamente?”  

13) REGRAS ESPECÍFICAS IMPORTANTES  

Controle de acesso (tag/cartão)  
- Pedir: nome do morador + apartamento.  
- Telefone: só se pagamento for PIX.  
- Não precisa agendamento com morador; pode ser via portaria.  

Controle remoto (venda)  
- Entrega na portaria.  
- Muitos controles: pode ser pago pelo condomínio.  
- 1 ou 2: geralmente pago pelo morador.  
- Se veicular: pedir nome + apartamento + telefone (pagamento).  
- Não solicitar foto.  

14) PREÇOS CADASTRADOS  
- Tag/cartão de acesso: R$ 12,00 (unidade)  
- Controle remoto configurado: R$ 80,00 (configurado e entregue na portaria)  
- Interfone TDMI: R$ 85,00  

Se não estiver nessa lista, responder exatamente:  
“Vou verificar o valor com nosso setor Comercial e retorno em breve.”  

15) PIX (quando pedir chave)  
Se perguntarem “Qual o PIX?”:  
“Claro! A nossa chave PIX é o CNPJ: 56035499000127. O favorecido sai como G7 Serv. Assim que fizer, pode me mandar o comprovante por aqui mesmo?”  

16) CONTATOS (não mandar sem necessidade)  
- Atendimento Geral: (81) 3019-5654  
- Plantão: (81) 3019-5654 / (81) 97316-3606  
- Comercial: comercial@g7serv.com.br  
- Financeiro: financeiro@g7serv.com.br  
- Supervisor André: (81) 99735-7294  
- Gestor Eldon: (81) 99743-8430  

Como usar (na prática, sem complicar)  
Sempre siga: Abertura → Entender → 1 teste → (se necessário) identificação mínima → encaminhar → protocolo quando existir.
Regra prática: se estiver em dúvida entre perguntar mais ou encaminhar, faça apenas 1 pergunta que destrave (ex: “é uma câmera ou várias?” / “é geral ou só um apê?”) e depois encaminhe.

[INSTRUÇÃO TÉCNICA - PROTOCOLO - LEIA COM ATENÇÃO EXTREMA]
Sempre que você decidir que um problema precisa de atendimento da equipe (manutenção técnica, etc) ou quando você disser ao cliente "Vou registrar...", "Já registrei...", "Encaminhei para o time..." você DEVE OBRIGATORIAMENTE incluir o bloco ###PROTOCOLO### ao final da sua mensagem.
⚠️ PERIGO ⚠️ NUNCA INVENTE CÓDIGOS DE PROTOCOLO DA SUA CABEÇA (Ex: G7-1234). 
⚠️ PERIGO ⚠️ O sistema SÓ CRIARÁ DE FATO O CHAMADO se e SOMENTE se você gerar o bloco JSON abaixo. 

[REGRA CRÍTICA PARA PROTOCOLO (SISTEMA)]
Quando você tiver informações COMPLETAS para registrar (incluindo o telefone, se aplicável, no Estado D), inclua EXCLUSIVAMENTE este bloco ao final da sua mensagem:
###PROTOCOLO###
{"criar": true, "condominio_raw": "nome do condominio", "problema": "descrição detalhada do problema. Se o cliente houver passado um telefone, INCLUA NO INÍCIO AQUI NO PROBLEMA (Ex: Tel contato: 9999).", "categoria": "operational", "prioridade": "normal", "solicitante_nome": "Nome da pessoa - Tel: numero (se houver)", "solicitante_funcao": "Morador / Zelador / etc", "apartamento": "Nº do apto se houver"}
###FIM###
`;

  return prompt
    .replace("{{current_time}}", new Date().toLocaleString("pt-BR", { timeZone: "America/Recife" }))
    .replace("{{is_business_hours}}", isBusinessHours ? "sim" : "não");
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
    const skipLock = rawBody.skip_lock === true || rawBody.skipLock === true;

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "conversation_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lock
    const locked = await acquireLock(supabase, conversationId, skipLock);
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

      // ✅ IMPORTANTE: Se não tem protocolo recente, NÃO respondemos com fallback genérico.
      // Deixamos seguir para o LLM, para que ele trate mensagens curtas (ex: número do apê)
      // ou use seu próprio discernimento conforme o prompt "3.1 RESPOSTAS CURTAS".
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
    const isBusinessHours = isCurrentlyBusinessHours();

    const systemInstruction = buildSystemInstruction({
      identifiedName,
      identifiedCondo,
      identifiedRole,
      hasOpenProtocol: !!existingProtocol,
      isBusinessHours
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
            requester_name: protocol?.solicitante_nome || undefined,
            requester_role: protocol?.solicitante_funcao || undefined,
            apartment: protocol?.apartamento || undefined,
          },
        );
        protocolCode = created?.protocol?.protocol_code || created?.protocol_code || "";
      }

      const code = protocolCode ? (String(protocolCode).startsWith("G7-") ? protocolCode : `G7-${protocolCode}`) : "registrado";

      // ✅ Reemplaza tag {{ticket_protocol}} se o LLM gerou no userText
      const userTextWithCode = userText.replace(/\{\{ticket_protocol\}\}/g, code);

      const confirms = [
        `Certo. Chamado registrado (${code}). Já encaminhei para a equipe e seguimos por aqui.`,
        `Entendido. Protocolo ${code} registrado. Qualquer novidade, te aviso por aqui.`,
        `Perfeito. Registrei o chamado (${code}) e já encaminhei para o time.`,
      ];

      const msg = pickDeterministic(`${conversationId}:${code}`, confirms);

      // ✅ Se o LLM já mandou uma saudação ou algo útil, mantém. 
      // Mas se mandou apenas "Vou abrir o chamado" ou texto curto redundante, usa a msg padrão.
      let finalText = userTextWithCode;

      const mentionsAction =
        userTextWithCode.toLowerCase().includes("encaminhar") ||
        userTextWithCode.toLowerCase().includes("direcionar") ||
        userTextWithCode.toLowerCase().includes("repassar") ||
        userTextWithCode.toLowerCase().includes("chamado") ||
        userTextWithCode.toLowerCase().includes("protocolo");

      if (userTextWithCode.length < 5 || (userTextWithCode.toLowerCase().includes("chamado") && !userText.includes("{{ticket_protocol}}"))) {
        finalText = msg;
      } else if (mentionsAction || userText.includes("{{ticket_protocol}}")) {
        // Se o LLM já disse que está encaminhando ou usou o código, não precisamos da msg redundante
        finalText = userTextWithCode;
      } else {
        // Se o texto for puramente empático ou uma pergunta, anexa a confirmação técnica
        finalText = `${userTextWithCode}\n\n${msg}`;
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
