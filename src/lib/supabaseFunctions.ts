import { supabase } from "@/integrations/supabase/client";

export async function callFunction<TResponse = any>(
    fnName: string,
    body: any
): Promise<TResponse> {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw new Error(sessionErr.message);

    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Sessão não encontrada/expirada. Faça login novamente.");

    // Debug: decode JWT to check issuer
    try {
        const payload = JSON.parse(atob(accessToken.split(".")[1]));
        console.log("[callFunction] JWT Debug:");
        console.log("  - jwt.iss:", payload.iss);
        console.log("  - jwt.aud:", payload.aud);
        console.log("  - jwt.sub (user):", payload.sub);
        console.log("  - VITE_SUPABASE_URL:", import.meta.env.VITE_SUPABASE_URL);

        // Check if issuer matches the expected project
        const expectedIssuer = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1`;
        if (payload.iss !== expectedIssuer) {
            console.error("[callFunction] ⚠️ JWT ISSUER MISMATCH!");
            console.error("  - Expected:", expectedIssuer);
            console.error("  - Got:", payload.iss);
            console.error("  - This is likely the cause of 401 Invalid JWT!");
        }
    } catch (e) {
        console.warn("[callFunction] Could not decode JWT:", e);
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`;
    const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    console.log(`[callFunction] Calling ${fnName}`, { url, hasApikey: !!apikey, hasToken: !!accessToken });

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey,
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { }

    if (!res.ok) {
        // devolve detalhes reais do Supabase gateway/function
        console.error(`[callFunction] ${fnName} failed:`, res.status, text);
        throw new Error(`Function ${fnName} failed (${res.status}): ${text || res.statusText}`);
    }

    return json as TResponse;
}
