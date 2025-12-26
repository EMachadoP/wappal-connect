import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // 1. Validação de Segurança (Security Token)
    const securityToken = Deno.env.get('ZAPI_SECURITY_TOKEN');
    const clientToken = req.headers.get('client-token');
    
    if (securityToken && clientToken !== securityToken) {
      console.error('[Z-API Webhook] Falha de autenticação: Token inválido');
      return new Response('Unauthorized', { status: 401 });
    }

    const payload = await req.json();
    const providerMessageId = payload.messageId;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 2. Verificação de Idempotência (Já processamos essa mensagem?)
    if (providerMessageId) {
      const { data: existing } = await supabase
        .from('messages')
        .select('id')
        .eq('provider_message_id', providerMessageId)
        .maybeSingle();
      
      if (existing) {
        console.log(`[Z-API Webhook] Mensagem ${providerMessageId} já processada. Ignorando.`);
        return new Response(JSON.stringify({ success: true, duplicated: true }));
      }
    }

    // ... Restante da lógica de processamento original (contatos e conversas)
    // (A lógica interna permanece a mesma do sistema, mas agora protegida pelo unique constraint do DB)

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Z-API Webhook Error]', error.message);
    return new Response(error.message, { status: 500 });
  }
});