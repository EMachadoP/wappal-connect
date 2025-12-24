import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createPipeline } from "./pipeline.ts";
import { loadInitialDataMiddleware } from "./middlewares/loadInitialData.ts";
import { checkFiltersMiddleware } from "./middlewares/checkFilters.ts";
import { processResponseMiddleware } from "./middlewares/processResponse.ts";
import { PipelineAbortError } from "./errors.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id } = await req.json();
    
    const ctx = {
      conversationId: conversation_id,
      supabaseUrl: Deno.env.get('SUPABASE_URL')!,
      supabaseServiceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    };

    const pipeline = createPipeline([
      loadInitialDataMiddleware,
      checkFiltersMiddleware,
      processResponseMiddleware,
    ]);

    await pipeline.execute(ctx as any);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (error instanceof PipelineAbortError) {
      console.log(`[Pipeline Aborted] ${error.reason}`);
      return new Response(JSON.stringify({ success: false, reason: error.reason }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.error('[Pipeline Error]', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});