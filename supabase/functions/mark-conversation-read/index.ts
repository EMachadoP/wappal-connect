import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

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

    // 1) ENV CHECKS
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

    // 2) AUTH CHECK
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
    const admin = createClient(supabaseUrl, serviceKey);
    const auth = createClient(supabaseUrl, serviceKey, {
        global: { headers: { Authorization: authHeader } },
    });

    try {
        // 5) VALIDATE USER FROM JWT
        const { data: u, error: uErr } = await auth.auth.getUser();
        if (uErr || !u?.user) {
            console.error("[mark-conversation-read] Invalid session:", uErr);
            return json(401, { error: "Invalid session" });
        }
        const userId = u.user.id;

        console.log(`[mark-conversation-read] User ${userId} marking conversation ${conversation_id} as read`);

        // 6) UPDATE READ STATE IN conversation_participant_state
        // First, ensure the record exists
        const { data: existing } = await admin
            .from("conversation_participant_state")
            .select("id")
            .eq("conversation_id", conversation_id)
            .maybeSingle();

        if (!existing) {
            // Create the record if it doesn't exist
            const { error: insertErr } = await admin
                .from("conversation_participant_state")
                .insert({
                    conversation_id,
                    last_read_at: new Date().toISOString(),
                    last_read_message_id,
                });

            if (insertErr) {
                console.error("[mark-conversation-read] Error creating participant state:", insertErr);
                return json(500, { error: `Failed to create participant state: ${insertErr.message}` });
            }
        } else {
            // Update existing record
            const { error: updErr } = await admin
                .from("conversation_participant_state")
                .update({
                    last_read_at: new Date().toISOString(),
                    last_read_message_id,
                })
                .eq("conversation_id", conversation_id);

            if (updErr) {
                console.error("[mark-conversation-read] Error updating participant state:", updErr);
                return json(500, { error: `Failed to update participant state: ${updErr.message}` });
            }
        }

        console.log("[mark-conversation-read] Successfully updated read state");

        // 7) MARK MESSAGES AS READ (optional but recommended for consistency)
        await admin
            .from("messages")
            .update({ read_at: new Date().toISOString() })
            .eq("conversation_id", conversation_id)
            .neq("sender_type", "agent")
            .is("read_at", null);

        // 8) RESET UNREAD COUNT
        await admin
            .from("conversations")
            .update({ unread_count: 0 })
            .eq("id", conversation_id);

        return json(200, { success: true, conversation_id });

    } catch (err: any) {
        console.error("[mark-conversation-read] Fatal error:", err?.message, err?.stack);
        return json(500, { error: err?.message || "unknown" });
    }
});
