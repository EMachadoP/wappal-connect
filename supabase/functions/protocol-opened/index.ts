import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripPrefix = (s: string) => (s || '').trim().replace(/^(u:|g:)/i, '');

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const protocol_id = body.protocol_id as string | undefined;
    const protocol_code = body.protocol_code as string | undefined;
    const idempotency_key =
      (body.idempotency_key as string | undefined) ||
      (protocol_id ? `protocol-opened:${protocol_id}` : protocol_code ? `protocol-opened:${protocol_code}` : undefined);

    if (!protocol_id && !protocol_code) {
      return new Response(JSON.stringify({ success: false, error: "protocol_id ou protocol_code é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // DB-first: carregar protocolo com joins úteis
    const q = supabase
      .from("protocols")
      .select(`
        id, protocol_code, summary, priority, category,
        requester_name, requester_role,
        condominium_name,
        conversation_id,
        conversations(id, contact_id),
        contacts:conversations(contacts(id, name, phone, chat_lid, lid, chat_key, is_group))
      `);

    const { data: protocol, error } = protocol_id
      ? await q.eq("id", protocol_id).maybeSingle()
      : await q.eq("protocol_code", protocol_code).maybeSingle();

    if (error || !protocol) throw new Error("Protocolo não encontrado");

    const { data: settings } = await supabase.from("integrations_settings").select("*").maybeSingle();
    const techGroupIdRaw = Deno.env.get("ZAPI_TECH_GROUP_CHAT_ID") || settings?.whatsapp_group_id;
    const techGroupId = stripPrefix(techGroupIdRaw || '');

    if (!settings?.whatsapp_notifications_enabled) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "notifications disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!techGroupId) {
      return new Response(JSON.stringify({ success: false, error: "Grupo técnico não configurado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Safely get protocol code with prefix
    const codeStr = protocol.protocol_code || "";
    const code = codeStr.startsWith("G7-") ? codeStr : `G7-${codeStr}`;

    const groupMsg =
      `*G7 Serv | Abertura de Chamado*
📅 ${new Date().toLocaleDateString("pt-BR")}

✅ *Protocolo:* ${code}
🏢 *Condomínio:* ${protocol.condominium_name || "Não Identificado"}
👤 *Solicitante:* ${protocol.requester_name || "Não informado"}
📝 *Resumo:* ${protocol.summary || "Sem descrição"}
📌 *Categoria:* ${protocol.category || "Operacional"}
🟢 *Prioridade:* ${protocol.priority || "normal"}
⏰ *Vencimento:* ${(protocol as any).due_date ? String((protocol as any).due_date).slice(0, 10) : "—"}
`;

    // Envia SOMENTE pro grupo (isGroup = true) e com idempotency_key
    await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "apikey": supabaseServiceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: techGroupId,
        content: groupMsg,
        isGroup: true,
        sender_name: "G7",
        idempotency_key: idempotency_key || `protocol-opened:${protocol.id}`,
      }),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error('[protocol-opened] Error:', err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
