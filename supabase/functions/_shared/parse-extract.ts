// Intent detection and structured data extraction for protocol creation

export type ExtractIntent = "none" | "create_schedule" | "create_protocol";

export type ExtractResult = {
    intent: ExtractIntent;
    draft: boolean;
    fields: {
        condominium_name?: string | null;
        category?: string | null;
        summary?: string | null;
        urgency?: "low" | "normal" | "high";
        suggested_time_window?: string | null;
    };
    missing_fields: string[];
    confidence: number;
    raw?: any;
};

function detectIntent(text: string, isEmployee: boolean): ExtractIntent {
    const t = text.trim();

    // Employee command patterns
    const cmd =
        /^CRIAR\s+AGENDAMENTO\b/i.test(t) ||
        /^ABRIR\s+CHAMADO\b/i.test(t) ||
        /^ABRIR\s+PROTOCOLO\b/i.test(t) ||
        /^CHAMADO\s*:/i.test(t) ||
        /^AGENDA\s*:/i.test(t);

    if (isEmployee && cmd) return "create_schedule";

    // Client keywords (existing behavior)
    if (!isEmployee) {
        if (/PORT[AÃ]O|INTERFONE|CFTV|C[ÂA]MERA|DVR|SEM IMAGEM|N[ÃA]O ABRE|TRAVOU/i.test(text)) {
            return "create_protocol";
        }
    }

    return "none";
}

function quickExtract(text: string) {
    const condo =
        text.match(/condom[ií]nio\s*:\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ??
        text.match(/\bcond\s*:\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ??
        null;

    const urgency: "low" | "normal" | "high" =
        /URGENTE|PARADO|N[ÃA]O FUNCIONA|TRAVOU|SEM ACESSO|SEM IMAGEM/i.test(text)
            ? "high"
            : "normal";

    let category: string | null = null;
    if (/INTERFONE/i.test(text)) category = "Interfone";
    else if (/CFTV|C[ÂA]MERA|DVR/i.test(text)) category = "Sistema de CFTV";
    else if (/PORT[AÃ]O|MOTOR/i.test(text)) category = "Motor de Portão de Veículos";
    else if (/TV|ANTENA|COLETIVA/i.test(text)) category = "Sistema de TV Coletiva";

    const cleaned = text
        .replace(/^(CRIAR\s+AGENDAMENTO|ABRIR\s+CHAMADO|ABRIR\s+PROTOCOLO|CHAMADO:|AGENDA:)\s*/i, "")
        .trim();
    const summary = cleaned ? cleaned.split("\n")[0].trim() : null;

    return { condominium_name: condo, category, summary, urgency };
}

export async function parseAndExtract(
    openai: any,
    args: {
        text: string;
        isEmployee: boolean;
        knownCondominiums?: string[];
    }
): Promise<ExtractResult> {
    const { text, isEmployee, knownCondominiums = [] } = args;

    const intent = detectIntent(text, isEmployee);
    if (intent === "none") {
        return { intent: "none", draft: false, fields: {}, missing_fields: [], confidence: 0.2 };
    }

    const quick = quickExtract(text);
    const missingQuick: string[] = [];
    if (!quick.condominium_name) missingQuick.push("condominium_name");
    if (!quick.category) missingQuick.push("category");
    if (!quick.summary) missingQuick.push("summary");

    // If quick extraction got everything, use it
    if (missingQuick.length === 0) {
        return {
            intent,
            draft: false,
            fields: { ...quick, suggested_time_window: null },
            missing_fields: [],
            confidence: 0.75,
            raw: { mode: "quick" },
        };
    }

    // Use LLM for structured extraction
    const system = `
Você é um extrator de dados para abrir chamados em condomínios.
Retorne SOMENTE JSON válido (sem markdown).
Não invente dados. Se não encontrar algo, retorne null.

Campos:
- condominium_name (string|null)
- category (string|null)
- summary (string|null)
- urgency ("low"|"normal"|"high")
- suggested_time_window (string|null)

Categorias permitidas:
- Motor de Portão de Veículos
- Acesso de Pedestres
- Porta de Acesso de Pedestres
- Interfone
- Sistema de CFTV
- Sistema de TV Coletiva
`.trim();

    const user = `
Mensagem (${isEmployee ? "FUNCIONÁRIO" : "CLIENTE"}):
"""${text}"""

Condomínios conhecidos:
${knownCondominiums.slice(0, 80).join(" | ")}
`.trim();

    try {
        const resp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ],
        });

        const json = JSON.parse(resp.choices[0].message.content);

        const fields = {
            condominium_name: (json.condominium_name ?? quick.condominium_name ?? null) as string | null,
            category: (json.category ?? quick.category ?? null) as string | null,
            summary: (json.summary ?? quick.summary ?? null) as string | null,
            urgency: (json.urgency ?? quick.urgency ?? "normal") as "low" | "normal" | "high",
            suggested_time_window: (json.suggested_time_window ?? null) as string | null,
        };

        const missing: string[] = [];
        if (!fields.condominium_name) missing.push("condominium_name");
        if (!fields.category) missing.push("category");
        if (!fields.summary) missing.push("summary");

        return {
            intent,
            draft: missing.length > 0,
            fields,
            missing_fields: missing,
            confidence: missing.length === 0 ? 0.9 : 0.6,
            raw: { mode: "llm", json },
        };
    } catch (err) {
        // Fallback to quick extraction on LLM error
        return {
            intent,
            draft: missingQuick.length > 0,
            fields: { ...quick, suggested_time_window: null },
            missing_fields: missingQuick,
            confidence: 0.5,
            raw: { mode: "quick_fallback", error: String(err) },
        };
    }
}
