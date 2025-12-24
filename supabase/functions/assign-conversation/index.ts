import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autorizado");

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error("Token inválido");

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Validação de Permissão
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleData || !["admin", "agent"].includes(roleData.role)) {
      throw new Error("Permissão insuficiente");
    }

    const { conversation_id, agent_id } = await req.json();

    // Validar se o agente de destino existe e é ativo
    const { data: targetAgent } = await supabaseAdmin
      .from("profiles")
      .select("id, name, is_active")
      .eq("id", agent_id)
      .single();

    if (!targetAgent || !targetAgent.is_active) {
      throw new Error("Agente de destino inválido ou inativo");
    }

    // Executar atribuição
    await supabaseAdmin
      .from("conversations")
      .update({
        assigned_to: agent_id,
        assigned_at: new Date().toISOString(),
        assigned_by: user.id, // Quem realizou a ação
      })
      .eq("id", conversation_id);

    // Registrar evento de sistema
    const { data: actor } = await supabaseAdmin.from("profiles").select("name").eq("id", user.id).single();
    
    await supabaseAdmin.from("messages").insert({
      conversation_id,
      sender_type: "system",
      message_type: "system",
      content: `👥 Atribuída para ${targetAgent.name} por ${actor?.name || "sistema"}`,
      sent_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});