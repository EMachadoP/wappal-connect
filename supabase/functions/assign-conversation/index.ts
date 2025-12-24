import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AssignRequest {
  conversation_id: string;
  agent_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    // Get auth header to identify caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[assign-conversation] Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate the caller using their JWT
    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      console.error("[assign-conversation] Auth error:", authError?.message);
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[assign-conversation] Caller: ${user.id} (${user.email})`);

    // Use service role client for DB operations (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Check if caller has agent or admin role
    const { data: callerRole, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError) {
      console.error("[assign-conversation] Role check error:", roleError.message);
      return new Response(
        JSON.stringify({ error: "Failed to verify permissions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!callerRole || !["admin", "agent"].includes(callerRole.role)) {
      console.error(`[assign-conversation] User ${user.id} has no valid role: ${callerRole?.role}`);
      return new Response(
        JSON.stringify({ error: "Permission denied: requires agent or admin role" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[assign-conversation] Caller role: ${callerRole.role}`);

    // Parse request body
    const { conversation_id, agent_id }: AssignRequest = await req.json();

    if (!conversation_id || !agent_id) {
      return new Response(
        JSON.stringify({ error: "Missing conversation_id or agent_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[assign-conversation] Assigning conversation ${conversation_id} to agent ${agent_id}`);

    // Verify target agent exists
    const { data: targetAgent, error: agentError } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .eq("id", agent_id)
      .maybeSingle();

    if (agentError || !targetAgent) {
      console.error("[assign-conversation] Target agent not found:", agent_id);
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update conversation assignment
    const { error: updateError } = await supabaseAdmin
      .from("conversations")
      .update({
        assigned_to: agent_id,
        assigned_at: new Date().toISOString(),
        assigned_by: user.id,
      })
      .eq("id", conversation_id);

    if (updateError) {
      console.error("[assign-conversation] Update error:", updateError.message);
      return new Response(
        JSON.stringify({ error: `Failed to assign: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get caller's name for the system message
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    // Insert system message for assignment
    const systemMessageContent = `✅ Atribuída para ${targetAgent.name} por ${callerProfile?.name || "usuário"}`;
    const { error: msgError } = await supabaseAdmin.from("messages").insert({
      conversation_id,
      sender_type: "system",
      message_type: "system",
      content: systemMessageContent,
      sent_at: new Date().toISOString(),
    });

    if (msgError) {
      console.warn("[assign-conversation] Failed to insert system message:", msgError.message);
      // Non-blocking, continue
    }

    console.log(`[assign-conversation] Success: assigned to ${targetAgent.name}`);

    return new Response(
      JSON.stringify({
        success: true,
        assigned_to: agent_id,
        agent_name: targetAgent.name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    console.error("[assign-conversation] Unexpected error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
