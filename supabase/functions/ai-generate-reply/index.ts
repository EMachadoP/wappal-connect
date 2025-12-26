import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { messages, systemPrompt, conversationId } = await req.json();

    // 1. Rate Limiting Simples (via DB)
    if (conversationId) {
      const { data: recentMsgs } = await supabase
        .from('ai_usage_logs')
        .select('id')
        .eq('conversation_id', conversationId)
        .gte('created_at', new Date(Date.now() - 60000).toISOString()); // último minuto

      if (recentMsgs && recentMsgs.length > 5) {
        logger.warn('Rate limit hit for conversation', { conversationId, requestId });
        return new Response(JSON.stringify({ error: 'Muitas requisições. Tente em breve.' }), { status: 429 });
      }
    }

    logger.info('Starting AI generation', { requestId, conversationId });

    // Chamada ao provedor (Lovable como padrão)
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    logger.info('AI generation complete', { 
      requestId, 
      latency, 
      tokens: data.usage?.total_tokens 
    });

    return new Response(JSON.stringify({
      text: data.choices[0].message.content,
      latency_ms: latency,
      provider: 'lovable',
      model: 'gemini-2.5-flash'
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    logger.error('Critical AI error', { requestId, error: error.message });
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
});