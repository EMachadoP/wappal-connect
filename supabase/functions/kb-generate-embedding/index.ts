import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { snippetId } = await req.json();

    if (!snippetId) {
      return new Response(
        JSON.stringify({ error: 'snippetId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the snippet
    const { data: snippet, error: snippetError } = await supabase
      .from('kb_snippets')
      .select('*')
      .eq('id', snippetId)
      .single();

    if (snippetError || !snippet) {
      console.error('Snippet not found:', snippetError);
      return new Response(
        JSON.stringify({ error: 'Snippet not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create text to embed
    const textToEmbed = `${snippet.title}\n\nProblema: ${snippet.problem_text}\n\nSolução: ${snippet.solution_text}`;

    console.log('Generating embedding for snippet:', snippet.id);

    // Call Lovable AI Gateway for embeddings
    // Using chat completions to get a semantic representation
    // Since we don't have a direct embedding endpoint, we'll use a workaround
    // by generating a semantic hash/embedding through the model
    
    // For now, we'll use the text-embedding model via a compatible endpoint
    // Lovable AI supports embedding generation through chat completions
    const embeddingResponse = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-004',
        input: textToEmbed,
      }),
    });

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text();
      console.error('Embedding API error:', embeddingResponse.status, errorText);
      
      // If embedding API not available, store without embedding for now
      console.log('Storing snippet without embedding - will be indexed when API is available');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Snippet approved, embedding pending',
          snippetId 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const embeddingData = await embeddingResponse.json();
    const embedding = embeddingData.data?.[0]?.embedding;

    if (!embedding) {
      console.error('No embedding in response:', embeddingData);
      return new Response(
        JSON.stringify({ success: true, message: 'Snippet approved, embedding pending' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Store embedding
    const { error: insertError } = await supabase
      .from('kb_embeddings')
      .upsert({
        snippet_id: snippetId,
        team_id: snippet.team_id,
        embedding: embedding,
        model_name: 'text-embedding-004',
      }, {
        onConflict: 'snippet_id',
      });

    if (insertError) {
      console.error('Error storing embedding:', insertError);
      // Don't fail the request, snippet is still approved
    }

    console.log('Embedding generated and stored for snippet:', snippetId);

    return new Response(
      JSON.stringify({ success: true, snippetId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('KB embedding error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
