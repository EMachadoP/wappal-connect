import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AIProviderConfig {
  id: string;
  provider: 'openai' | 'gemini' | 'lovable';
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  active: boolean;
  key_ref: string;
}

interface GenerateRequest {
  messages: { role: string; content: string }[];
  systemPrompt: string;
  providerId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { messages, systemPrompt, providerId } = await req.json() as GenerateRequest;

    // Get active provider config
    let providerQuery = supabase
      .from('ai_provider_configs')
      .select('*')
      .eq('active', true);

    if (providerId) {
      providerQuery = providerQuery.eq('id', providerId);
    }

    const { data: providers, error: providerError } = await providerQuery.limit(1).single();

    if (providerError || !providers) {
      console.error('No active AI provider found:', providerError);
      return new Response(
        JSON.stringify({ error: 'Nenhum provedor de IA ativo configurado' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = providers as AIProviderConfig;
    console.log('Using provider:', provider.provider, provider.model);

    // Get API key from environment
    let apiKey: string | undefined;
    
    if (provider.provider === 'lovable') {
      apiKey = Deno.env.get('LOVABLE_API_KEY');
    } else if (provider.key_ref) {
      apiKey = Deno.env.get(provider.key_ref);
    }

    if (!apiKey) {
      console.error('API key not found for provider:', provider.provider);
      return new Response(
        JSON.stringify({ error: `Chave de API não encontrada para ${provider.provider}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build request based on provider
    let response: Response;
    let responseData: any;

    if (provider.provider === 'lovable') {
      // Use Lovable AI Gateway
      response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          temperature: Number(provider.temperature) || 0.7,
          max_tokens: provider.max_tokens || 1024,
        }),
      });
    } else if (provider.provider === 'openai') {
      // Direct OpenAI API
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          temperature: Number(provider.temperature) || 0.7,
          max_tokens: provider.max_tokens || 1024,
        }),
      });
    } else if (provider.provider === 'gemini') {
      // Direct Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${apiKey}`;
      
      // Convert messages to Gemini format
      const geminiMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      response = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: geminiMessages,
          generationConfig: {
            temperature: Number(provider.temperature) || 0.7,
            maxOutputTokens: provider.max_tokens || 1024,
            topP: Number(provider.top_p) || 1.0,
          },
        }),
      });
    } else {
      return new Response(
        JSON.stringify({ error: `Provedor não suportado: ${provider.provider}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Limite de requisições excedido. Tente novamente mais tarde.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Créditos insuficientes. Adicione créditos ao workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: `Erro da API: ${errorText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    responseData = await response.json();
    
    // Extract response based on provider format
    let generatedText: string;
    let tokensIn = 0;
    let tokensOut = 0;

    if (provider.provider === 'gemini' && !provider.model.includes('/')) {
      // Native Gemini API response
      generatedText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      tokensIn = responseData.usageMetadata?.promptTokenCount || 0;
      tokensOut = responseData.usageMetadata?.candidatesTokenCount || 0;
    } else {
      // OpenAI-compatible response (Lovable AI, OpenAI, Gemini via gateway)
      generatedText = responseData.choices?.[0]?.message?.content || '';
      tokensIn = responseData.usage?.prompt_tokens || 0;
      tokensOut = responseData.usage?.completion_tokens || 0;
    }

    const latencyMs = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        text: generatedText,
        provider: provider.provider,
        model: provider.model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        latency_ms: latencyMs,
        request_id: crypto.randomUUID(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('AI generate error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
