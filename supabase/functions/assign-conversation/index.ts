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
    // 1. Validar Quem está Operando
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autorizado");

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error("Sessão inválida");

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Validar status do autor
    const { data: actor } = await supabaseAdmin.from("profiles").select("name, is_active").eq("id", user.id).single();
    if (!actor?.is_active) throw new Error("Agente inativo");

    // 2. Validar Dados da Atribuição
    const { conversation_id, agent_id } = await req.json();

    // Validar Agente de Destino
    const { data: target } = await supabaseAdmin.from("profiles").select("name, is_active").eq("id", agent_id).single();
    if (!target?.is_active) throw new Error("Agente de destino indisponível");

    // 3. Executar com Log de Sistema
    const { error: updError } = await supabaseAdmin
      .from("conversations")
      .update({
        assigned_to: agent_id,
        assigned_at: new Date().toISOString(),
        assigned_by: user.id // Capturado da sessão, não do payload
      })
      .eq("id", conversation_id);

    if (updError) throw updError;

    // Timeline audit
    await supabaseAdmin.from("messages").insert({
      conversation_id,
      sender_type: "system",
      message_type: "system",
      content: `👥 Atribuída para ${target.name} por ${actor.name}`,
      sent_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});