import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
                status: 405,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
        const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const authHeader = req.headers.get("Authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
            return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 1) Valida usuário usando o JWT (anon client + auth header)
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: userData, error: userErr } = await userClient.auth.getUser();
        if (userErr || !userData?.user) {
            return new Response(JSON.stringify({ error: "Unauthorized", details: userErr?.message }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const userId = userData.user.id;

        // 2) Admin client (service role) para inserir/atualizar (bypass RLS)
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        const payload = await req.json();
        const title = String(payload.title ?? "").trim();
        if (!title) {
            return new Response(JSON.stringify({ error: "title is required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
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
            return new Response(JSON.stringify({ error: insErr.message }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

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
                return new Response(JSON.stringify({ task, warning: "Conversation assign failed", details: convErr.message }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
        }

        return new Response(JSON.stringify({ task }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
