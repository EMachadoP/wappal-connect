import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { conversation_id } = await req.json();

        if (!conversation_id) {
            return new Response(
                JSON.stringify({ error: "conversation_id is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log(`[mark-conversation-read] Marking conversation ${conversation_id} as read`);

        // 1. Marcar todas as mensagens inbound como lidas
        const { error: messagesError, count } = await supabase
            .from("messages")
            .update({ read_at: new Date().toISOString() })
            .eq("conversation_id", conversation_id)
            .neq("sender_type", "agent")  // Não marcar mensagens do próprio agente
            .is("read_at", null);

        if (messagesError) {
            console.error("[mark-conversation-read] Error updating messages:", messagesError);
            throw messagesError;
        }

        console.log(`[mark-conversation-read] Marked ${count || 0} messages as read`);

        // 2. Zerar unread_count na conversa
        const { error: conversationError } = await supabase
            .from("conversations")
            .update({
                unread_count: 0,
                last_read_at: new Date().toISOString()
            })
            .eq("id", conversation_id);

        if (conversationError) {
            console.error("[mark-conversation-read] Error updating conversation:", conversationError);
            throw conversationError;
        }

        return new Response(
            JSON.stringify({
                success: true,
                marked_count: count || 0,
                conversation_id
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("[mark-conversation-read] Error:", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
