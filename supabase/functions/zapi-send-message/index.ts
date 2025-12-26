import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withRetry } from "../_shared/resilience.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id, content } = await req.json();
    
    // ... Lógica de obtenção de credentials e recipient (original)
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const token = Deno.env.get('ZAPI_TOKEN');

    // Executa a chamada com Retry Exponencial (3 tentativas)
    const result = await withRetry(async () => {
      const response = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: 'RECIPIENT_HERE', message: content }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Z-API Error: ${error}`);
      }
      return await response.json();
    });

    return new Response(JSON.stringify({ success: true, result }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[zapi-send-message] Final Failure:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});