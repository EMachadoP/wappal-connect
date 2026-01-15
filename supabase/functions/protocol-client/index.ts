// supabase/functions/protocol-client/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    try {
        const body = await req.json();
        const protocol_id = body.protocol_id;
        const idempotency_key = body.idempotency_key || `protocol-client:${protocol_id}`;

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // ✅ FIX: JOIN com condominiums
        const { data: protocol, error } = await supabase
            .from("protocols")
            .select(`
        id, 
        protocol_code, 
        summary, 
        priority, 
        category,
        requester_name, 
        due_date,
        condominium_id,
        condominiums!inner(name),
        conversations(
          id, 
          contact_id, 
          contacts(id, name, phone, chat_lid, lid, chat_key, is_group)
        )
      `)
            .eq("id", protocol_id)
            .maybeSingle();

        if (error || !protocol) {
            console.error("[protocol-client] Query error:", error);
            throw new Error(`Protocolo não encontrado: ${error?.message || 'unknown'}`);
        }

        // ✅ FIX: Acessar condominium via JOIN
        const condominiumName = protocol.condominiums?.name || "Não informado";
        const contact = protocol.conversations?.contacts;

        if (!contact) throw new Error("Contato do protocolo não encontrado");

        const recipientPhone = contact.phone;
        const recipientLid = contact.chat_lid || contact.lid;

        if (!recipientPhone && !recipientLid) {
            throw new Error("Cliente sem telefone ou LID para envio");
        }

        const code = protocol.protocol_code.startsWith("G7-")
            ? protocol.protocol_code
            : `G7-${protocol.protocol_code}`;

        const clientMsg = `🎯 *Protocolo Gerado*

Olá ${contact.name || "Cliente"}!

Seu chamado foi registrado com sucesso:

✅ *Protocolo:* ${code}
🏢 *Condomínio:* ${condominiumName}
📌 *Categoria:* ${protocol.category || "Operacional"}
🟢 *Prioridade:* ${protocol.priority || "normal"}
⏰ *Vencimento:* ${protocol.due_date ? String(protocol.due_date).slice(0, 10) : "—"}

📝 *Resumo:*
${protocol.summary || "Sem descrição adicional."}

_Nosso time já foi notificado e em breve retornaremos._

*G7 Serv* | Gestão de Condomínios`;

        const recipient = recipientPhone || recipientLid;

        console.log(`[protocol-client] Enviando para cliente: ${recipient}`);

        const zapiResp = await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${supabaseServiceKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                recipient,
                content: clientMsg,
                isGroup: false,
                idempotency_key
            }),
        });

        const result = await zapiResp.json();

        if (!zapiResp.ok && !result.deduped) {
            throw new Error(`Falha Z-API: ${zapiResp.status} - ${JSON.stringify(result)}`);
        }

        console.log(`[protocol-client] Mensagem enviada: ${result.deduped ? "deduped" : "sent"}`);

        return new Response(
            JSON.stringify({ success: true, recipient, messageId: result.messageId }),
            {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200
            }
        );

    } catch (err: any) {
        console.error("[protocol-client] Error:", err.message, err.stack);
        return new Response(
            JSON.stringify({ error: err.message }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            }
        );
    }
});
