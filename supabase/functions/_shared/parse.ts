// Deterministic command parsing for employee protocol creation

import { onlyDigits } from "./ids.ts";

export type ParsedCommand =
    | { intent: "none" }
    | { intent: "needs_more_info"; missing: ("condominium" | "summary")[]; hint: string }
    | {
        intent: "create_protocol";
        forceNew: boolean;
        condominiumName: string;
        summary: string;
        priority: "normal" | "critical";
        category: string;
    };

function isWeakSummary(s: string): boolean {
    const t = s.trim().toLowerCase();
    if (t.length < 12) return true;
    return ["oi", "bom dia", "boa tarde", "boa noite", "ok", "beleza", "certo", "👍"].includes(t);
}

/**
 * Parse employee command text (deterministic, no LLM).
 * Detects patterns like:
 * - "CRIAR AGENDAMENTO: Condomínio Ed. X - câmera sem imagem"
 * - "ABRIR CHAMADO: Ed. X / problema..."
 * 
 * REQUIRES both condominium AND summary to proceed.
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
        upper.includes("ASSUNTO DIFERENTE") ||
        upper.includes("FORCE_NEW");

    // Detect urgency
    const priority: "normal" | "critical" =
        upper.includes("URGENTE") || upper.includes("CRITICO") || upper.includes("CRÍTICO")
            ? "critical"
            : "normal";

    // 1) Extract condominium name
    const condoMatch =
        text.match(/(?:CONDOM[IÍ]NIO)\s*[:\-]\s*(.+?)(?:\s*[-–—\/]\s*|\n|$)/i) ||
        text.match(/CRIAR\s+AGENDAMENTO\s*[:\-]\s*(.+?)(?:\s*[-–—\/]\s*|$)/i) ||
        text.match(/ABRIR\s+CHAMADO\s*[:\-]\s*(.+?)(?:\s*[-–—\/]\s*|$)/i);

    const condominiumName = condoMatch ? condoMatch[1].trim() : "";

    // 2) Extract summary (problem description)
    let summary = text
        .replace(/cri(ar|e)\s+agendamento\s*[:\-]?\s*/i, "")
        .replace(/abrir\s+chamado\s*[:\-]?\s*/i, "")
        .replace(/^chamado:\s*/i, "")
        .replace(/^agendar:\s*/i, "")
        .trim();

    // If format is "Condomínio X - problem...", remove the condo part from summary
    if (condominiumName && summary.toLowerCase().startsWith(condominiumName.toLowerCase())) {
        summary = summary.slice(condominiumName.length).replace(/^(\s*[-–—\/:]\s*)/, "").trim();
    }

    // Validate mandatory fields
    const missing: ("condominium" | "summary")[] = [];
    if (!condominiumName || condominiumName.length < 4) missing.push("condominium");
    if (!summary || isWeakSummary(summary)) missing.push("summary");

    if (missing.length > 0) {
        return {
            intent: "needs_more_info",
            missing,
            hint:
                "Para eu abrir o chamado, me envie assim:\n" +
                "*CRIAR AGENDAMENTO: Condomínio <nome> - <problema detalhado>*\n\n" +
                "Exemplo:\n" +
                "CRIAR AGENDAMENTO: Ed. Parque da Jaqueira - Câmera 04 sem imagem na garagem."
        };
    }

    return {
        intent: "create_protocol",
        forceNew,
        condominiumName,
        summary,
        priority,
        category: "operational",
    };
}
