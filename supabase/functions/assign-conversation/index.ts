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
    // 1. Validar Sessão do Usuário
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autorizado: Token ausente");

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error("Sessão inválida");

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Validar Role do Atuante (quem está atribuindo)
    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("name, is_active")
      .eq("id", user.id)
      .single();

    if (!actorProfile || !actorProfile.is_active) throw new Error("Agente inativo");

    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleData || !["admin", "agent"].includes(roleData.role)) {
      throw new Error("Permissão insuficiente");
    }

    const { conversation_id, agent_id } = await req.json();

    // 3. Validar se o Agente de Destino existe e está ativo
    const { data: targetAgent, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, is_active")
      .eq("id", agent_id)
      .single();

    if (targetErr || !targetAgent || !targetAgent.is_active) {
      throw new Error("Agente de destino não encontrado ou inativo");
    }

    // 4. Validar Existência da Conversa
    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("id", conversation_id)
      .single();

    if (!conversation) throw new Error("Conversa não encontrada");

    // 5. Executar Atribuição Atomizada
    const { error: updateError } = await supabaseAdmin
      .from("conversations")
      .update({
        assigned_to: agent_id,
        assigned_at: new Date().toISOString(),
        assigned_by: user.id,
      })
      .eq("id", conversation_id);

    if (updateError) throw updateError;

    // 6. Log de Sistema (Auditoria na Timeline)
    await supabaseAdmin.from("messages").insert({
      conversation_id,
      sender_type: "system",
      message_type: "system",
      content: `👥 Atribuída para ${targetAgent.name} por ${actorProfile.name}`,
      sent_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error('[Assign Error]', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});