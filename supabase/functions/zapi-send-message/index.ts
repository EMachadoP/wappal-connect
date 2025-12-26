import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withRetry } from "../_shared/resilience.ts";
import { logger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id, content, sender_name } = await req.json();
    
    if (!conversation_id || !content) {
      throw new Error("Parâmetros inválidos: id e conteúdo são obrigatórios.");
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Obter identificador do destinatário
    const { data: conv } = await supabase
      .from('conversations')
      .select('chat_id, contacts(phone, chat_lid)')
      .eq('id', conversation_id)
      .single();

    const recipient = conv?.chat_id || conv?.contacts?.chat_lid || conv?.contacts?.phone;
    if (!recipient) throw new Error("Destinatário não encontrado.");

    // 2. Enviar via Z-API com Retry
    const result = await withRetry(async () => {
      const response = await fetch(`https://api.z-api.io/instances/${Deno.env.get('ZAPI_INSTANCE_ID')}/token/${Deno.env.get('ZAPI_TOKEN')}/send-text`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Client-Token': Deno.env.get('ZAPI_SECURITY_TOKEN') || ''
        },
        body: JSON.stringify({ phone: recipient, message: content }),
      });

      if (!response.ok) throw new Error(`Z-API Error: ${await response.text()}`);
      return await response.json();
    });

    return new Response(JSON.stringify({ success: true, result }), { headers: corsHeaders });

  } catch (error) {
    logger.error('zapi-send-message-failure', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});