// WhatsApp ID normalization and extraction utilities

export type Identity = {
    lid?: string | null;
    phoneE164?: string | null;
    chatKey?: string | null;
    waFrom?: string | null;
};

export function normalizePhoneBR(raw?: string | null): string | null {
    if (!raw) return null;
    // Se contiver @lid ou @g.us, não é um telefone puro Brasil
    if (String(raw).includes("@lid") || String(raw).includes("@g.us")) return null;

    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;

    // BR típico: 10~11 sem DDI; com DDI: 12~13 (55 + DDD + 8/9)
    // LID pode ter 14 ou mais dígitos. Evitamos que lid vire phone.
    if (digits.length > 13) return null;
    if (digits.startsWith("55")) return digits;
    // Se tiver 10 ou 11 dígitos, assume BR
    if (digits.length === 10 || digits.length === 11) return "55" + digits;
    return digits;
}

export function normalizeChatId(input: string): string | null {
    const v0 = (input || "").trim().toLowerCase().replace("@gus", "@g.us");
    if (!v0) return null;

    // ✅ Preserve @lid
    if (v0.endsWith("@lid")) return v0;

    const left = v0.split("@")[0] || "";
    const hasAt = v0.includes("@");
    const looksGroup = v0.endsWith("@g.us") || left.includes("-");

    if (looksGroup) {
        const base = hasAt ? v0 : left;
        return base.endsWith("@g.us") ? base : `${base}@g.us`;
    }

    const digits = left.replace(/\D/g, "");
    if (!digits) return null;

    if (digits.length >= 14 && !digits.startsWith('55')) return `${digits}@lid`;

    const br = (digits.length === 10 || digits.length === 11) ? `55${digits}` : digits;
    return `${br}@s.whatsapp.net`;
}

export function threadKeyFromChatId(chatId: string): string {
    const cid = (chatId || "").trim().toLowerCase();
    if (cid.endsWith("@g.us")) return `group:${cid}`;
    // For DMs, we use u:digits as internal lookup key
    const base = cid.split("@")[0];
    const dig = base.replace(/\D/g, "");
    if (!dig) return `u:${base}`; // LID caso não tenha dígitos puros (raro)
    return `u:${dig}`;
}

export function extractIdentity(p: any): Identity {
    const lid =
        p?.contact?.lid ||
        p?.chatLid ||
        p?.lid ||
        (typeof p?.from === "string" && p.from.includes("@lid") ? p.from : null) ||
        (typeof p?.chatId === "string" && p.chatId.includes("@lid") ? p.chatId : null) ||
        (typeof p?.recipient === "string" && p.recipient.includes("@lid") ? p.recipient : null);

    const phoneE164 =
        normalizePhoneBR(p?.contact?.phone || p?.phone || p?.recipient) ||
        (typeof p?.from === "string" && p.from.includes("@s.whatsapp.net")
            ? normalizePhoneBR(p.from.split("@")[0])
            : null) ||
        (typeof p?.chatId === "string" && p.chatId.includes("@s.whatsapp.net")
            ? normalizePhoneBR(p.chatId.split("@")[0])
            : null) ||
        (typeof p?.recipient === "string" && p.recipient.includes("@s.whatsapp.net")
            ? normalizePhoneBR(p.recipient.split("@")[0])
            : null);

    // chatKey: para conversa/thread (preferir chatLid quando existir)
    const chatKey =
        p?.chatLid ||
        (typeof p?.chatId === "string" ? p.chatId.replace("@gus", "@g.us") : null) ||
        (lid ? lid : phoneE164 ? `${phoneE164}@s.whatsapp.net` : null);

    return { lid, phoneE164, chatKey, waFrom: p?.from || null };
}

export function isPurePhone(id: string): boolean {
    const digits = id.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 13 && !id.includes("@lid");
}

export function isLid(id: string): boolean {
    return id.endsWith("@lid") || (id.length >= 14 && !id.startsWith("55") && !id.includes("-"));
}
