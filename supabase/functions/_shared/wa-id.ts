// WhatsApp ID normalization and extraction utilities

export function normalizeWaId(raw?: string | null): string | null {
    if (!raw) return null;
    const v = String(raw).trim();
    if (!v) return null;

    // Preserve important suffixes (@lid, @g.us)
    if (v.endsWith("@lid") || v.endsWith("@g.us")) return v;

    // Remove legacy suffixes only (@c.us, @s.whatsapp.net)
    return v
        .replace(/@c\.us$/i, "")
        .replace(/@s\.whatsapp\.net$/i, "");
}

export function candidateSenderIds(payload: any): string[] {
    const ids = new Set<string>();
    const add = (x: any) => {
        const n = normalizeWaId(x);
        if (n) ids.add(n);
    };

    // LID identifiers (preferred)
    add(payload?.lid);
    add(payload?.contact?.lid);
    add(payload?.chatLid);

    // Phone identifiers
    add(payload?.phone);
    add(payload?.senderPhone);
    add(payload?.contact?.phone);

    // Fallback
    add(payload?.chatId);

    return [...ids];
}

export function isPurePhone(id: string): boolean {
    return /^\d{10,15}$/.test(id);
}

export function isLid(id: string): boolean {
    return id.endsWith("@lid");
}
