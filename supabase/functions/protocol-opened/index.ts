import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function translateCategory(c: string) {
  return {
    financial: "Financeiro",
    support: "Suporte",
    admin: "Administrativo"
  }[c] || "Operacional";
}

function translatePriority(p: string) {
  return p === "critical" ? "Crítico" : "Normal";
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = req.headers.get("authorization")?.replace("Bearer ", "");
    if (auth !== supabaseServiceKey) {
      return new Response("Não autorizado", { status: 401 });
    }

    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
    const { protocol_code } = await req.json();

    console.log('=== PROTOCOL OPENED ===');
    console.log('Protocol Code:', protocol_code);

    // 1. Buscar protocolo completo
    const { data: protocol, error: protocolError } = await supabase
      .from('protocols')
      .select('*, conversations(*, condominiums(name), contacts(*))')
      .eq('protocol_code', protocol_code)
      .single();

    if (protocolError || !protocol) {
      throw new Error(`Protocolo não encontrado: ${protocolError?.message}`);
    }

    const conv = protocol.conversations as any;
    const condoName = conv?.condominiums?.name || "Não Identificado";
    const requesterName = protocol.requester_name || conv?.contacts?.name || "Não identificado";
    const category = protocol.category || "operational";
    const priority = protocol.priority || "normal";
    const dueDate = new Date().toISOString().split('T')[0];

    // 2. Buscar configurações
    const { data: settings } = await supabase
      .from("integrations_settings")
      .select("*")
      .single();

    // ========== NOTIFICAÇÃO DO GRUPO (TÉCNICOS) ==========
    if (settings?.whatsapp_notifications_enabled) {
      // ✅ ENV primeiro, depois banco
      const envGroupId = Deno.env.get("ZAPI_TECH_GROUP_CHAT_ID");
      const dbGroupId = settings.whatsapp_group_id;
      const techGroupId = envGroupId || dbGroupId;

      console.log('=== GROUP NOTIFICATION ===');
      console.log('Enabled:', settings.whatsapp_notifications_enabled);
      console.log('Source:', envGroupId ? 'Environment (ZAPI_TECH_GROUP_CHAT_ID)' : 'Database (integrations_settings)');
      console.log('Group ID:', techGroupId);

      if (!techGroupId) {
        console.error('❌ ZAPI_TECH_GROUP_CHAT_ID não configurado!');
        throw new Error('ID do grupo de técnicos não está configurado');
      }

      const groupMsg = `*G7 Serv | Abertura de Chamado*\n\n` +
        `✅ *Protocolo:* G7-${protocol_code}\n` +
        `🏢 *Condomínio:* ${condoName}\n` +
        `👤 *Solicitante:* ${requesterName}\n` +
        `📝 *Resumo:* ${protocol.summary || "Sem descrição"}\n` +
        `⏰ *Vencimento:* ${dueDate}`;

      console.log('Invocando zapi-send-message para grupo...');

      // ✅ Usar recipient padronizado (wrapper vai formatar para @g.us se isGroup for true)
      const groupRes = await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
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
          sender_name: "G7"
        }),
      });

      const groupResult = await groupRes.json();
      console.log('Group Response:', JSON.stringify(groupResult, null, 2));

      // ✅ Salvar log no banco com status explícito
      await supabase.from('protocol_notifications').insert({
        protocol_id: protocol.id,
        channel: 'group',
        recipient: techGroupId,
        status: groupResult.success ? 'success' : 'error',
        error: groupResult.success ? null : (groupResult.error || 'Falha desconhecida')
      });

      if (!groupResult.success) {
        console.error('❌ Falha ao enviar para grupo:', groupResult.error);
      } else {
        console.log('✅ Enviado com sucesso para o grupo!');
      }
    } else {
      console.log('ℹ️ Notificações WhatsApp desabilitadas');
    }

    // ========== NOTIFICAÇÃO DO CLIENTE ==========
    if (conv?.id) {
      console.log('=== CLIENT NOTIFICATION ===');
      const clientMsg = `📋 *Protocolo aberto*\n\n` +
        `🔖 *Número:* G7-${protocol_code}\n` +
        `🏢 *Condomínio:* ${condoName}\n` +
        `📂 *Categoria:* ${translateCategory(category)}\n` +
        `📝 *Chamado:* ${protocol.summary || 'Sem descrição'}`;

      const clientRes = await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseServiceKey}`,
          "apikey": supabaseServiceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: conv.id,
          content: clientMsg,
          sender_name: "G7"
        }),
      });

      const clientResult = await clientRes.json();
      console.log('Client Response:', JSON.stringify(clientResult, null, 2));
    }

    return new Response(JSON.stringify({ success: true, protocol_code }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error('[Protocol Opened Error]', err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
