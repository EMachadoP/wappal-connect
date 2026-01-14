import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toZapiRecipient } from "../_shared/ids.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Load secrets with guards
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[protocol-client] Missing required secrets", {
        hasUrl: !!supabaseUrl,
        hasServiceKey: !!supabaseServiceKey
    });
}

// Get SLA message based on priority  
function getSLAMessage(priority: string): string {
    const slaMessages: Record<string, string[]> = {
        critical: [
            "Vamos resolver isso hoje mesmo!",
            "Nossa equipe está priorizando seu atendimento para hoje.",
            "Atendimento urgente - resolveremos no mesmo dia.",
        ],
        high: [
            "Vamos resolver isso hoje mesmo!",
            "Nossa equipe está priorizando seu atendimento para hoje.",
            "Atendimento prioritário - resolveremos no mesmo dia.",
        ],
        normal: [
            "Daremos retorno em até 2 dias úteis.",
            "Você terá uma resposta em até 2 dias úteis.",
            "Resolveremos em até 2 dias úteis.",
        ],
        low: [
            "Daremos retorno em até 2 dias úteis.",
            "Você terá uma resposta em até 2 dias úteis.",
            "Atenderemos em até 2 dias úteis.",
        ],
    };

    const messages = slaMessages[priority] || slaMessages.normal;
    return messages[Math.floor(Math.random() * messages.length)];
}

// Translate category to Portuguese
function translateCategory(category: string): string {
    const map: Record<string, string> = {
        operational: "Operacional",
        support: "Suporte",
        financial: "Financeiro",
        commercial: "Comercial",
        admin: "Administrativo",
    };
    return map[category] || "Operacional";
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // Validate secrets
        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(JSON.stringify({ error: "Missing configuration" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // Internal auth: verify service role key
        const auth = req.headers.get("authorization") || "";
        const token = auth.replace("Bearer ", "").trim();

        if (token !== supabaseServiceKey) {
            console.error("[protocol-client] Unauthorized call - invalid token");
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // Create admin client (accepts service role auth)
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false }
        });

        const { protocol_id, protocol_code } = await req.json();

        console.log('[protocol-client] Notifying client for protocol:', protocol_code);

        // DB-FIRST: Load all data from database
        const { data: protocolData } = await supabase
            .from('protocols')
            .select(`
        *,
        conversations (
          id,
          contact_id,
          active_condominium_id,
          condominiums (name),
          contacts (name, phone, chat_lid)
        )
      `)
            .eq('protocol_code', protocol_code)
            .maybeSingle();

        if (!protocolData) {
            console.error('[protocol-client] Protocol not found:', protocol_code);
            return new Response(JSON.stringify({ error: 'Protocol not found' }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const protocol = protocolData;
        const conversation = (protocol.conversations as any) ?? {};
        const condominium = ((conversation.condominiums as any) ?? {}) as { name?: string };
        const contact = ((conversation.contacts as any) ?? {}) as { name?: string; phone?: string; chat_lid?: string };

        const condominiumName = condominium.name || "Não Identificado";
        const category = translateCategory(protocol.category || "operational");
        const summary = protocol.summary || "Sem descrição";
        const conversation_id = conversation.id;

        if (!conversation_id || !contact) {
            console.warn('[protocol-client] No conversation or contact found');
            return new Response(JSON.stringify({ error: 'No conversation/contact' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Check deduplication
        const { data: existingNotif } = await supabase
            .from('protocol_notifications')
            .select('id')
            .eq('protocol_id', protocol.id)
            .eq('channel', 'client')
            .maybeSingle();

        if (existingNotif) {
            console.log('[protocol-client] Client already notified, skipping');
            return new Response(JSON.stringify({ success: true, skipped: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const slaMessage = getSLAMessage(protocol.priority || 'normal');

        const clientMessage = `📋 *Protocolo aberto*

🔖 *Número:* G7-${protocol_code}
🏢 *Condomínio:* ${condominiumName}
📂 *Categoria:* ${category}
📝 *Chamado:* ${summary}

${slaMessage}

O protocolo foi aberto em nosso sistema e o responsável fará a tratativa.`;

        // Send via zapi-send-message
        const sendResult = await supabase.functions.invoke("zapi-send-message", {
            body: {
                conversation_id,
                content: clientMessage,
                message_type: "text",
                sender_name: "G7",
            },
        });

        console.log('[protocol-client] Message sent:', sendResult.data);

        // Mark as notified with details
        await supabase.from('protocol_notifications').insert({
            protocol_id: protocol.id,
            channel: 'client',
            status: sendResult.data?.success ? 'success' : 'error',
            recipient: conversation.chat_id || contact.chat_lid || contact.phone,
            error: sendResult.data?.error || (sendResult.data?.success ? null : 'Unknown error'),
            sent_at: new Date().toISOString()
        });

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('[protocol-client] Error:', error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
