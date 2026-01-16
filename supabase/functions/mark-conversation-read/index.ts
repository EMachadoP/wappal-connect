import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    // 1) ENV CHECKS (evita crash silencioso -> 500 genérico)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
        const missing = [
            !supabaseUrl ? "SUPABASE_URL" : null,
            !serviceKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
        ].filter(Boolean);
        console.error("[mark-conversation-read] Missing env:", missing);
        return json(500, { error: `Missing environment variables: ${missing.join(", ")}` });
    }

    // 2) AUTH CHECK (não aceita sem Bearer)
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
        return json(401, { error: "Missing Bearer token" });
    }

    // 3) JSON PARSE SAFE
    let body: any;
    try {
        body = await req.json();
    } catch (e) {
        console.error("[mark-conversation-read] Invalid JSON:", e);
        return json(400, { error: "Invalid JSON body" });
    }

    const conversation_id = body?.conversation_id;
    const last_read_message_id = body?.last_read_message_id ?? null;

    if (!conversation_id) {
        return json(400, { error: "conversation_id is required" });
    }

    // 4) CLIENTS
    // admin: service role (bypass RLS) -> para fazer o update
    const admin = createClient(supabaseUrl, serviceKey);

    // auth: valida o JWT do usuário chamador
    const auth = createClient(supabaseUrl, serviceKey, {
        global: { headers: { Authorization: authHeader } },
    });

    try {
        // 5) VALIDAR USUÁRIO PELO JWT
        const { data: u, error: uErr } = await auth.auth.getUser();
        if (uErr || !u?.user) {
            console.error("[mark-conversation-read] Invalid session:", uErr);
            return json(401, { error: "Invalid session" });
        }
        const userId = u.user.id;

        // 6) UPDATE DO ESTADO DE LEITURA
        // ✅ Opção A: tabela por participante (conversation_participants)
        const { error: updErr } = await admin
            .from("conversation_participants")
            .update({
                last_read_at: new Date().toISOString(),
                last_read_message_id,
            })
            .eq("conversation_id", conversation_id)
            .eq("profile_id", userId);

        if (!updErr) {
            console.log("[mark-conversation-read] Success: marked as read for user", userId);
            return json(200, { success: true });
        }

        console.error("[mark-conversation-read] Update failed:", updErr);
        return json(500, { error: updErr.message });
    } catch (err: any) {
        console.error("[mark-conversation-read] Fatal:", err?.message, err?.stack);
        return json(500, { error: err?.message || "unknown" });
    }
});
