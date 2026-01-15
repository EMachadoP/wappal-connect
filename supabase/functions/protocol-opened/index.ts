import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stripPrefix = (s: string) => (s || '').trim().replace(/^(u:|g:)/i, '');

const isValidGroupJid = (s: string) => {
  const x = (s || '').trim().toLowerCase();
  if (x.endsWith('@g.us')) return true;
  return /^\d{10,14}-\d+$/.test(stripPrefix(x));
};

const normalizeGroupJid = (s: string) => {
  let x = stripPrefix((s || '').trim().toLowerCase());
  if (!x) return x;
  if (x.includes('@')) return x;
  return `${x}@g.us`;
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const body = await req.json();
    const protocol_id = body.protocol_id;
    const protocol_code = body.protocol_code;
    const idempotency_key = body.idempotency_key || `protocol-opened:${protocol_id}`;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const q = supabase.from("protocols").select(`
        id, protocol_code, summary, priority, category,
        requester_name, requester_role, condominium_name, due_date, conversation_id,
        conversations(id, contact_id, contacts(id, name, phone, chat_lid, lid, chat_key, is_group))
      `);

    const { data: protocol, error } = protocol_id
      ? await q.eq("id", protocol_id).maybeSingle()
      : await q.eq("protocol_code", protocol_code).maybeSingle();

    if (error || !protocol) throw new Error(`Protocolo não encontrado: ${error?.message || ''}`);

    const { data: settings } = await supabase.from("integrations_settings").select("*").maybeSingle();
    const techGroupIdRaw = Deno.env.get("ZAPI_TECH_GROUP_CHAT_ID") || settings?.whatsapp_group_id;
    const techGroupId = normalizeGroupJid(techGroupIdRaw || '');

    if (!techGroupIdRaw || !isValidGroupJid(techGroupIdRaw)) {
      throw new Error(`ID do grupo técnico inválido. Recebido: ${techGroupIdRaw}`);
    }

    const code = protocol.protocol_code.startsWith("G7-") ? protocol.protocol_code : `G7-${protocol.protocol_code}`;
    const groupMsg = `*G7 Serv | Abertura de Chamado*
✅ *Protocolo:* ${code}
🏢 *Condomínio:* ${protocol.condominium_name || "—"}
👤 *Solicitante:* ${protocol.requester_name || "Não informado"}
📝 *Resumo:* ${protocol.summary || "Sem descrição"}
📌 *Categoria:* ${protocol.category || "Operacional"}
🟢 *Prioridade:* ${protocol.priority || "normal"}
⏰ *Vencimento:* ${protocol.due_date ? String(protocol.due_date).slice(0, 10) : "—"}`;

    const zapiResp = await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${supabaseServiceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: techGroupId,
        content: groupMsg,
        isGroup: true,
        idempotency_key
      }),
    });

    if (!zapiResp.ok) throw new Error(`Falha Z-API: ${zapiResp.status}`);

    return new Response(JSON.stringify({ success: true, techGroupId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
