// Deterministic command parsing for employee protocol creation

import { onlyDigits } from "./ids.ts";

export type ParsedCommand =
    | { intent: "none" }
    | {
        intent: "create_protocol";
        forceNew?: boolean;
        condominiumName?: string | null;
        targetPhone?: string | null;
        summary: string;
        priority?: "normal" | "critical";
        category?: string;
    };

/**
 * Parse employee command text (deterministic, no LLM).
 * Detects patterns like:
 * - "CRIAR AGENDAMENTO portão travado no Condomínio X"
 * - "ABRIR CHAMADO: câmera sem imagem"
 * - "CHAMADO: interfone não funciona"
 */
export function parseAndExtract(
    textRaw: string | null | undefined
): ParsedCommand {
    const text = (textRaw ?? "").trim();
    if (!text) return { intent: "none" };

    const upper = text.toUpperCase();

    // Detect command keywords
    const isCommand =
        upper.includes("CRIAR AGENDAMENTO") ||
        upper.includes("ABRIR CHAMADO") ||
        upper.startsWith("CHAMADO:") ||
        upper.startsWith("AGENDAR:");

    if (!isCommand) return { intent: "none" };

    // Force new protocol (different subject)
    const forceNew =
        upper.includes("NOVO") ||
        upper.includes("FORCE") ||
        upper.includes("ASSUNTO DIFERENTE");

    // Extract target phone: "CLIENTE 81 99999-9999"
    const phoneMatch = text.match(
        /(?:CLIENTE|TEL|FONE|WHATS)\s*[:\-]?\s*([\d\(\)\-\s\+]{8,})/i
    );
    const targetPhone = phoneMatch ? onlyDigits(phoneMatch[1]) : null;

    // Extract condominium: "CONDOMÍNIO: Edifício X"
    const condoMatch = text.match(
        /(?:CONDOM[IÍ]NIO)\s*[:\-]\s*(.+?)(?:$|\n)/i
    );
    const condominiumName = condoMatch ? condoMatch[1].trim() : null;

    // Extract summary: remove command prefix and use the rest
    let summary = text
        .replace(/cri(ar|e)\s+agendamento\s*[:\-]?\s*/i, "")
        .replace(/abrir\s+chamado\s*[:\-]?\s*/i, "")
        .replace(/^chamado:\s*/i, "")
        .replace(/^agendar:\s*/i, "")
        .trim();

    if (!summary) {
        summary = "Solicitação enviada pelo funcionário via WhatsApp.";
    }

    // Detect urgency
    const priority: "normal" | "critical" =
        upper.includes("URGENTE") || upper.includes("CRITICO")
            ? "critical"
            : "normal";

    return {
        intent: "create_protocol",
        forceNew,
        condominiumName,
        targetPhone,
        summary,
        priority,
        category: "operational",
    };
}
