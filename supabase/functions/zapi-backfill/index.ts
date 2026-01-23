import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * zapi-backfill - Reimporta mensagens do Z-API para o banco de dados
 * 
 * Uso:
 * POST /zapi-backfill
 * {
 *   "phone": "5581999999999",        // Telefone específico (opcional)
 *   "chatId": "5581999999999@s.whatsapp.net", // Chat ID específico (opcional)
 *   "since": "2024-01-20T00:00:00Z", // Data inicial (opcional, default: 24h atrás)
 *   "limit": 100,                    // Máximo de mensagens por chat (opcional, default: 100)
 *   "dryRun": false                  // Se true, não salva, só retorna o que faria
 * }
 * 
 * Comportamento:
 * - Busca mensagens na Z-API
 * - Para cada mensagem, faz POST no zapi-webhook com header x-backfill: 1
 * - O webhook não chama IA nem incrementa unread quando x-backfill: 1
 * - Idempotente via provider_message_id (não duplica)
 */

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      phone,
      chatId,
      since,
      limit = 100,
      dryRun = false,
    } = body;

    // Z-API credentials
    const { data: zapiSettings } = await supabase
      .from("zapi_settings")
      .select("*")
      .limit(1)
      .single();

    const instanceId = Deno.env.get("ZAPI_INSTANCE_ID") || zapiSettings?.zapi_instance_id;
    const token = Deno.env.get("ZAPI_TOKEN") || zapiSettings?.zapi_token;
    const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN") || zapiSettings?.zapi_security_token;

    if (!instanceId || !token) {
      throw new Error("Configurações de Z-API não encontradas");
    }

    const zapiBaseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (clientToken) headers["Client-Token"] = clientToken;

    // Determinar data inicial (default: 24h atrás)
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sinceTimestamp = Math.floor(sinceDate.getTime() / 1000);

    console.log(`[Backfill] Iniciando backfill desde ${sinceDate.toISOString()}`);

    // Se phone/chatId específico, buscar só dele
    // Senão, buscar lista de chats recentes e processar cada um
    let chatsToProcess: { phone: string; isGroup: boolean }[] = [];

    if (phone || chatId) {
      const targetPhone = phone || (chatId ? chatId.split("@")[0] : null);
      const isGroup = chatId?.includes("@g.us") || false;
      if (targetPhone) {
        chatsToProcess.push({ phone: targetPhone, isGroup });
      }
    } else {
      // Buscar chats recentes
      const chatsResponse = await fetch(`${zapiBaseUrl}/chats?page=1&pageSize=50`, { headers });
      if (chatsResponse.ok) {
        const chats = await chatsResponse.json();
        if (Array.isArray(chats)) {
          chatsToProcess = chats
            .filter((c: any) => c.phone && parseInt(c.lastMessageTime) > sinceTimestamp)
            .map((c: any) => ({ phone: c.phone, isGroup: c.isGroup || false }));
        }
      }
    }

    console.log(`[Backfill] ${chatsToProcess.length} chats para processar`);

    let totalMessages = 0;
    let processedMessages = 0;
    let skippedMessages = 0;
    let errors = 0;
    const results: any[] = [];
    const debugInfo: any[] = []; // Para debug

    for (const chat of chatsToProcess) {
      try {
        // Buscar histórico de mensagens do chat
        // Z-API endpoint: GET /chat-messages/{phone}?amount=N&lastMessageId=X
        // NOTA: Este endpoint NÃO funciona no modo Multi Device!
        const messagesUrl = `${zapiBaseUrl}/chat-messages/${chat.phone}?amount=${limit}`;
        console.log(`[Backfill] Buscando mensagens de ${chat.phone} via /chat-messages...`);

        const messagesResponse = await fetch(messagesUrl, { 
          method: "GET",
          headers
        });
        
        const responseText = await messagesResponse.text();
        
        // Verificar se é erro de Multi Device
        if (responseText.includes("Multi Device") || responseText.includes("multi-device")) {
          console.error(`[Backfill] ⚠️ ERRO: Endpoint não disponível no modo Multi Device`);
          debugInfo.push({
            phone: chat.phone,
            status: messagesResponse.status,
            error: "MULTI_DEVICE_NOT_SUPPORTED",
            message: "O endpoint /chat-messages não está disponível no modo Multi Device. Use o webhook para capturar mensagens em tempo real."
          });
          errors++;
          continue;
        }
        
        let result: any;
        try {
          result = JSON.parse(responseText);
        } catch {
          console.error(`[Backfill] Resposta não é JSON válido de ${chat.phone}: ${responseText.slice(0, 200)}`);
          debugInfo.push({
            phone: chat.phone,
            status: messagesResponse.status,
            error: "INVALID_JSON",
            rawPreview: responseText.slice(0, 300)
          });
          errors++;
          continue;
        }
        
        // Verificar se é erro da API
        if (result.error) {
          console.error(`[Backfill] Erro da Z-API para ${chat.phone}: ${result.error} - ${result.message}`);
          debugInfo.push({
            phone: chat.phone,
            status: messagesResponse.status,
            error: result.error,
            message: result.message
          });
          errors++;
          continue;
        }
        
        // DEBUG: Guardar resposta raw para análise
        debugInfo.push({
          phone: chat.phone,
          status: messagesResponse.status,
          rawKeys: Object.keys(result || {}),
          rawPreview: JSON.stringify(result).slice(0, 300),
        });
        
        console.log(`[Backfill] Resposta raw de ${chat.phone}:`, JSON.stringify(result).slice(0, 500));
        
        // Z-API retorna { messages: [...] } ou array direto
        const messages = Array.isArray(result) ? result : (result.messages || result.data || []);
        
        if (!Array.isArray(messages) || messages.length === 0) {
          console.log(`[Backfill] Nenhuma mensagem extraída para ${chat.phone}. Keys disponíveis:`, Object.keys(result || {}));
          continue;
        }
        
        console.log(`[Backfill] ${messages.length} mensagens encontradas para ${chat.phone}`);

        // Filtrar mensagens pelo timestamp
        const filteredMessages = messages.filter((msg: any) => {
          const msgTimestamp = msg.timestamp || msg.momment;
          if (!msgTimestamp) return false;
          const msgDate = new Date(typeof msgTimestamp === "number" 
            ? (msgTimestamp > 9999999999 ? msgTimestamp : msgTimestamp * 1000)
            : msgTimestamp);
          return msgDate >= sinceDate;
        });

        console.log(`[Backfill] ${filteredMessages.length} mensagens de ${chat.phone} após ${sinceDate.toISOString()}`);
        totalMessages += filteredMessages.length;

        for (const msg of filteredMessages) {
          try {
            // Montar payload estilo webhook
            const webhookPayload = {
              // IDs
              messageId: msg.messageId || msg.id?.id,
              chatId: msg.chatId || `${chat.phone}${chat.isGroup ? "@g.us" : "@s.whatsapp.net"}`,
              phone: chat.phone,
              
              // Direção
              fromMe: msg.fromMe || false,
              direction: msg.fromMe ? "outbound" : "inbound",
              
              // Conteúdo
              type: msg.type || "text",
              text: msg.text || msg.body || msg.caption ? { message: msg.text?.message || msg.body || msg.caption || "" } : undefined,
              body: msg.body || msg.text?.message || "",
              caption: msg.caption,
              
              // Mídia
              image: msg.image,
              imageUrl: msg.imageUrl || msg.image?.url,
              audio: msg.audio,
              audioUrl: msg.audioUrl || msg.audio?.url,
              video: msg.video,
              videoUrl: msg.videoUrl || msg.video?.url,
              document: msg.document,
              documentUrl: msg.documentUrl || msg.document?.url,
              
              // Metadata
              timestamp: msg.timestamp || msg.momment,
              senderName: msg.senderName || msg.pushName || msg.notifyName,
              pushName: msg.pushName || msg.notifyName,
              isGroup: chat.isGroup,
              
              // Contact info (se disponível)
              contact: msg.contact || {
                phone: chat.phone,
                name: msg.senderName || msg.pushName,
              },
            };

            if (dryRun) {
              results.push({
                messageId: webhookPayload.messageId,
                chatId: webhookPayload.chatId,
                fromMe: webhookPayload.fromMe,
                type: webhookPayload.type,
                timestamp: webhookPayload.timestamp,
                preview: (webhookPayload.body || "").slice(0, 50),
              });
              processedMessages++;
              continue;
            }

            // POST para o webhook com header x-backfill
            const webhookResponse = await fetch(`${supabaseUrl}/functions/v1/zapi-webhook`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
                "apikey": supabaseServiceKey,
                "x-backfill": "1", // ← Flag para o webhook não chamar IA
              },
              body: JSON.stringify(webhookPayload),
            });

            if (webhookResponse.ok) {
              processedMessages++;
            } else {
              const errText = await webhookResponse.text();
              console.error(`[Backfill] Erro no webhook para msg ${webhookPayload.messageId}: ${errText}`);
              skippedMessages++;
            }

          } catch (msgErr: any) {
            console.error(`[Backfill] Erro processando mensagem:`, msgErr.message);
            skippedMessages++;
          }
        }

      } catch (chatErr: any) {
        console.error(`[Backfill] Erro processando chat ${chat.phone}:`, chatErr.message);
        errors++;
      }
    }

    const summary = {
      success: true,
      dryRun,
      since: sinceDate.toISOString(),
      chatsProcessed: chatsToProcess.length,
      totalMessages,
      processedMessages,
      skippedMessages,
      errors,
      ...(dryRun ? { preview: results.slice(0, 50), debug: debugInfo } : {}),
    };

    console.log(`[Backfill] Concluído:`, summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[Backfill] Erro:", error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
