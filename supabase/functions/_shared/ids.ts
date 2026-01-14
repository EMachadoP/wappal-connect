// LID-safe WhatsApp ID normalization and formatting utilities

export function onlyDigits(s: string | null | undefined): string {
    return (s ?? "").replace(/\D/g, "");
}

export function hasSuffix(id: string, suffix: string): boolean {
    return id.toLowerCase().endsWith(suffix);
}

/**
 * Normalizes WhatsApp ID without breaking LID or group formats.
 * - Preserves @lid and @g.us
 * - Removes @c.us and @s.whatsapp.net
 */
export function normalizeWaId(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const v = raw.trim();

    // Preserve LID and groups
    if (hasSuffix(v, "@lid") || hasSuffix(v, "@g.us")) return v;

    // Remove legacy suffixes
    if (hasSuffix(v, "@c.us")) return v.slice(0, -5);
    if (hasSuffix(v, "@s.whatsapp.net")) {
        return v.slice(0, -"@s.whatsapp.net".length);
    }

    return v;
}

/**
 * Formats contact for Z-API recipient (LID-first).
 * - If has @lid -> use it directly
 * - Otherwise -> use phone@s.whatsapp.net
 */
export function toZapiRecipient(contact: {
    lid?: string | null;
    chat_lid?: string | null;
    phone?: string | null;
}): string | null {
    // Priority 1: chat_lid with @lid
    const chatLid = normalizeWaId(contact?.chat_lid ?? null);
    if (chatLid && hasSuffix(chatLid, "@lid")) return chatLid;

    // Priority 2: lid with @lid
    const lid = normalizeWaId(contact?.lid ?? null);
    if (lid && hasSuffix(lid, "@lid")) return lid;

    // Priority 3: phone as E.164 + @s.whatsapp.net
    const phoneDigits = onlyDigits(contact?.phone ?? null);
    if (phoneDigits) return `${phoneDigits}@s.whatsapp.net`;

    // Fallback: any normalized ID
    const anyId = normalizeWaId(contact?.phone ?? null);
    if (anyId) {
        if (anyId.includes("@")) return anyId;
        return `${anyId}@s.whatsapp.net`;
    }

    return null;
}

/**
 * Generates thread_key for conversation (LID-first).
 */
export function generateThreadKey(payload: {
    chatLid?: string | null;
    chatId?: string | null;
    phone?: string | null;
    isGroup?: boolean;
}): string | null {
    // For groups, use chatId/chatLid as-is
    if (payload.isGroup) {
        return normalizeWaId(payload.chatLid ?? payload.chatId);
    }

    // For 1-on-1: prioritize LID
    const chatLid = normalizeWaId(payload.chatLid);
    if (chatLid && hasSuffix(chatLid, "@lid")) return chatLid;

    const chatId = normalizeWaId(payload.chatId);
    if (chatId) return chatId;

    const phone = normalizeWaId(payload.phone);
    if (phone) return phone;

    return null;
}
