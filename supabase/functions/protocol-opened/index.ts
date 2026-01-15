// supabase/functions/protocol-opened/index.ts
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

    // ✅ FIX: JOIN com condominiums para pegar o nome
    const q = supabase.from("protocols").select(`
        id, 
        protocol_code, 
        summary, 
        priority, 
        category,
        requester_name, 
        requester_role, 
        due_date, 
        conversation_id,
        condominium_id,
        condominiums!inner(name),
        conversations(id, contact_id, contacts(id, name, phone, chat_lid, lid, chat_key, is_group))
      `);

    const { data: protocol, error } = protocol_id
      ? await q.eq("id", protocol_id).maybeSingle()
      : await q.eq("protocol_code", protocol_code).maybeSingle();

    if (error || !protocol) {
      console.error("[protocol-opened] Query error:", error);
      throw new Error(`Protocolo não encontrado: ${error?.message || 'unknown error'}`);
    }

    const { data: settings } = await supabase.from("integrations_settings").select("*").maybeSingle();
    const techGroupIdRaw = Deno.env.get("ZAPI_TECH_GROUP_CHAT_ID") || settings?.whatsapp_group_id;

    if (!techGroupIdRaw) {
      throw new Error("ID do grupo técnico não configurado. Configure ZAPI_TECH_GROUP_CHAT_ID ou whatsapp_group_id");
    }

    const techGroupId = normalizeGroupJid(techGroupIdRaw);

    if (!isValidGroupJid(techGroupIdRaw)) {
      throw new Error(`ID do grupo técnico inválido. Recebido: ${techGroupIdRaw}, Normalizado: ${techGroupId}`);
    }

    // ✅ FIX: Acessar nome do condomínio via JOIN
    const condominiumName = protocol.condominiums?.name || "Não informado";

    const code = protocol.protocol_code.startsWith("G7-") ? protocol.protocol_code : `G7-${protocol.protocol_code}`;

    const groupMsgCard = `*G7 Serv | Abertura de Chamado*
✅ *Protocolo:* ${code}
🏢 *Condomínio:* ${condominiumName}
👤 *Solicitante:* ${protocol.requester_name || "Não informado"}
📌 *Categoria:* ${protocol.category || "Operacional"}
🟢 *Prioridade:* ${protocol.priority || "normal"}
⏰ *Vencimento:* ${protocol.due_date ? String(protocol.due_date).slice(0, 10) : "—"}`;

    const groupMsgSummary = `*Resumo do Protocolo ${code}:*
${protocol.summary || "Sem descrição adicional."}`;

    console.log(`[protocol-opened] Enviando para grupo: ${techGroupId}`);

    async function safeJson(resp: Response) {
      const raw = await resp.text();
      try { return JSON.parse(raw); } catch { return { raw }; }
    }

    // Enviar CARD
    const zapiRespCard = await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: techGroupId,
        content: groupMsgCard,
        isGroup: true,
        idempotency_key: `${idempotency_key}:card`
      }),
    });

    const cardResult = await safeJson(zapiRespCard);

    if (!zapiRespCard.ok && !cardResult.deduped) {
      throw new Error(`Falha Z-API (Card): ${zapiRespCard.status} - ${JSON.stringify(cardResult)}`);
    }

    console.log(`[protocol-opened] Card enviado: ${cardResult.deduped ? "deduped" : "sent"}, messageId=${cardResult.messageId || 'N/A'}`);

    // Enviar SUMMARY (se houver resumo relevante)
    if (protocol.summary && protocol.summary.length > 5) {
      const zapiRespSummary = await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          recipient: techGroupId,
          content: groupMsgSummary,
          isGroup: true,
          idempotency_key: `${idempotency_key}:summary`
        }),
      });

      const summaryResult = await safeJson(zapiRespSummary);

      if (!zapiRespSummary.ok && !summaryResult.deduped) {
        console.error(`[protocol-opened] Falha no summary: ${JSON.stringify(summaryResult)}`);
      } else {
        console.log(`[protocol-opened] Summary enviado: ${summaryResult.deduped ? "deduped" : "sent"}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, techGroupId, protocol_code: code }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    );

  } catch (err: any) {
    console.error("[protocol-opened] Error:", err.message, err.stack);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
