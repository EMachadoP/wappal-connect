// supabase/functions/create-task/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TaskStatus = "pending" | "in_progress" | "waiting" | "done" | "cancelled";
type TaskPriority = "low" | "normal" | "high" | "urgent";

type CreateTaskPayload = {
    title: string;
    description?: string | null;
    conversation_id?: string | null;
    assignee_id?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    due_at?: string | null;
    remind_at?: string | null;
    assign_conversation?: boolean;
    external_ref?: string | null;
};

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
        const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        // 1) Extrai usuário do JWT do request (Authorization: Bearer ...)
        const authHeader = req.headers.get("Authorization") ?? "";

        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: userData, error: userErr } = await admin.auth.getUser();
        if (userErr || !userData?.user) return json(401, { error: "Unauthorized" });

        const userId = userData.user.id;

        // 2) Valida payload
        const payload = (await req.json()) as CreateTaskPayload;

        const title = (payload.title ?? "").trim();
        if (!title) return json(400, { error: "title is required" });

        const status: TaskStatus = payload.status ?? "pending";
        const priority: TaskPriority = payload.priority ?? "normal";

        // 3) Insere task (usando service role para bypassar RLS)
        const { data: task, error: insErr } = await admin
            .from("tasks")
            .insert({
                title,
                description: payload.description ?? null,
                conversation_id: payload.conversation_id ?? null,
                assignee_id: payload.assignee_id ?? null,
                status,
                priority,
                due_at: payload.due_at ?? null,
                remind_at: payload.remind_at ?? null,
                created_by: userId,
                external_ref: payload.external_ref ?? null,
            })
            .select("*")
            .single();

        if (insErr) return json(500, { error: insErr.message });

        // 4) (Opcional) atribui conversa também
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
                // não derruba a criação da task, mas avisa
                return json(200, { task, warning: "task created, but conversation assign failed", details: convErr.message });
            }
        }

        return json(200, { task });
    } catch (e) {
        return json(500, { error: (e as Error).message ?? "Unknown error" });
    }
});
