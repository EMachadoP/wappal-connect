import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
        const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        // Debug: check if secrets are loaded
        console.log("[create-task] SUPABASE_URL:", SUPABASE_URL ? "SET" : "MISSING");
        console.log("[create-task] ANON_KEY:", ANON_KEY ? "SET" : "MISSING");
        console.log("[create-task] SERVICE_ROLE_KEY:", SERVICE_ROLE_KEY ? "SET" : "MISSING");

        const authHeader = req.headers.get("Authorization") ?? "";
        console.log("[create-task] Authorization header:", authHeader ? `Bearer ${authHeader.substring(7, 20)}...` : "MISSING");

        if (!authHeader.startsWith("Bearer ")) {
            return json(401, { error: "Missing Authorization Bearer token" });
        }

        // 1) Valida usuário usando o JWT (anon client + auth header)
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: userData, error: userErr } = await userClient.auth.getUser();
        console.log("[create-task] getUser result:", userData?.user?.id || "NO USER", userErr?.message || "NO ERROR");

        if (userErr || !userData?.user) {
            return json(401, { error: "Unauthorized", details: userErr?.message || "No user data" });
        }

        const userId = userData.user.id;
        console.log("[create-task] Authenticated user:", userId);

        // 2) Admin client (service role) para inserir/atualizar (bypass RLS)
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        const payload = await req.json();
        console.log("[create-task] Payload:", JSON.stringify(payload));

        const title = String(payload.title ?? "").trim();
        if (!title) {
            return json(400, { error: "title is required" });
        }

        const { data: task, error: insErr } = await admin
            .from("tasks")
            .insert({
                title,
                description: payload.description ?? null,
                conversation_id: payload.conversation_id ?? null,
                assignee_id: payload.assignee_id ?? null,
                status: payload.status ?? "pending",
                priority: payload.priority ?? "normal",
                due_at: payload.due_at ?? null,
                remind_at: payload.remind_at ?? null,
                created_by: userId,
                external_ref: payload.external_ref ?? null,
            })
            .select("*")
            .single();

        if (insErr) {
            console.error("[create-task] Insert error:", insErr.message);
            return json(500, { error: insErr.message });
        }

        console.log("[create-task] Task created:", task.id);

        // Opcional: atribui conversa
        if (payload.assign_conversation && payload.conversation_id && payload.assignee_id) {
            const { error: convErr } = await admin
                .from("conversations")
                .update({
                    assigned_to: payload.assignee_id,
                    assigned_at: new Date().toISOString(),
                    assigned_by: userId
                })
                .eq("id", payload.conversation_id);

            if (convErr) {
                console.warn("[create-task] Conversation assign failed:", convErr.message);
                return json(200, { task, warning: "Conversation assign failed", details: convErr.message });
            }

            // ✅ ADD: Create system message in chat for task creation
            const { data: assigneeProfile } = await admin
                .from("profiles")
                .select("name")
                .eq("id", payload.assignee_id)
                .maybeSingle();

            const assigneeName = assigneeProfile?.name || "Responsável";
            const messageText = `📋 Tarefa criada: "${title}" - Responsável: ${assigneeName}`;

            const { error: msgErr } = await admin
                .from("messages")
                .insert({
                    conversation_id: payload.conversation_id,
                    content: messageText,
                    direction: "outbound",
                    sender_type: "system",
                    status: "delivered",
                    sent_at: new Date().toISOString()
                });

            if (msgErr) {
                console.warn("[create-task] Failed to create system message:", msgErr.message);
            } else {
                // ✅ Update last_message_at so conversation appears in assignee's inbox
                const now = new Date().toISOString();
                await admin
                    .from("conversations")
                    .update({ last_message_at: now })
                    .eq("id", payload.conversation_id);
            }
        }

        return json(200, { task });
    } catch (e) {
        console.error("[create-task] Exception:", (e as Error).message);
        return json(500, { error: (e as Error).message });
    }
});
