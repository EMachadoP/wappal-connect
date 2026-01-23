import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConversationForIngestion {
  id: string;
  contact_id: string;
  messages: {
    content: string | null;
    sender_type: string;
    sent_at: string;
  }[];
  contacts: {
    name: string;
    whatsapp_display_name: string | null;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('Starting KB daily ingestion...');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find resolved conversations from last 24h that haven't been processed
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        contact_id,
        contacts (
          name,
          whatsapp_display_name
        )
      `)
      .eq('status', 'resolved')
      .gte('updated_at', yesterday.toISOString())
      .limit(50);

    if (convError) {
      console.error('Error fetching conversations:', convError);
      throw convError;
    }

    if (!conversations || conversations.length === 0) {
      console.log('No resolved conversations to process');
      return new Response(
        JSON.stringify({ processed: 0, message: 'No conversations to process' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check which ones haven't been processed yet
    const { data: existingResolutions } = await supabase
      .from('conversation_resolution')
      .select('conversation_id')
      .in('conversation_id', conversations.map(c => c.id));

    const processedIds = new Set((existingResolutions || []).map(r => r.conversation_id));
    const toProcess = conversations.filter(c => !processedIds.has(c.id));

    console.log(`Found ${toProcess.length} conversations to process`);

    let snippetsCreated = 0;

    for (const conv of toProcess) {
      try {
        // Fetch messages for this conversation
        const { data: messages } = await supabase
          .from('messages')
          .select('content, sender_type, sent_at')
          .eq('conversation_id', conv.id)
          .order('sent_at', { ascending: true })
          .limit(30);

        if (!messages || messages.length < 4) {
          console.log(`Skipping conversation ${conv.id} - not enough messages`);
          continue;
        }

        // Build conversation text for analysis
        const conversationText = messages
          .filter(m => m.content)
          .map(m => `${m.sender_type === 'contact' ? 'Cliente' : 'Atendente'}: ${m.content}`)
          .join('\n');

        // Call AI to extract structured resolution
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `Você é um analista de suporte. Analise a conversa e extraia um resumo estruturado.
Responda APENAS com JSON válido no formato:
{
  "category": "categoria do problema (ex: suporte, vendas, financeiro, técnico)",
  "problem_summary": "resumo do problema do cliente em 1-2 frases",
  "solution_summary": "resumo da solução fornecida em 2-3 frases",
  "is_valuable": true/false (se vale a pena salvar como conhecimento),
  "suggested_title": "título sugerido para o snippet"
}

Regras:
- Se a conversa não tiver uma resolução clara, marque is_valuable como false
- Seja conciso e objetivo
- Não inclua informações pessoais (nomes, telefones, etc)
- Não inclua preços específicos`,
              },
              {
                role: 'user',
                content: `Analise esta conversa:\n\n${conversationText}`,
              },
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
        });

        if (!response.ok) {
          console.error(`AI error for conversation ${conv.id}:`, await response.text());
          continue;
        }

        const aiData = await response.json();
        const aiContent = aiData.choices?.[0]?.message?.content || '';

        // Parse JSON from response
        let resolution;
        try {
          // Try to extract JSON from the response
          const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolution = JSON.parse(jsonMatch[0]);
          } else {
            console.log(`Could not parse AI response for ${conv.id}`);
            continue;
          }
        } catch (parseError) {
          console.error(`JSON parse error for ${conv.id}:`, parseError);
          continue;
        }

        // Save conversation resolution
        await supabase
          .from('conversation_resolution')
          .insert({
            conversation_id: conv.id,
            category: resolution.category,
            resolution_summary: resolution.solution_summary,
            resolution_steps: [resolution.problem_summary, resolution.solution_summary],
          });

        // If valuable, create a snippet for approval
        if (resolution.is_valuable) {
          const { error: snippetError } = await supabase
            .from('kb_snippets')
            .insert({
              title: resolution.suggested_title || `Resolução: ${resolution.category}`,
              category: resolution.category,
              problem_text: resolution.problem_summary,
              solution_text: resolution.solution_summary,
              source: 'auto_ingest',
              approved: false,
              confidence_score: 0.7,
            });

          if (!snippetError) {
            snippetsCreated++;
            console.log(`Created snippet for conversation ${conv.id}`);
          }
        }

      } catch (convError) {
        console.error(`Error processing conversation ${conv.id}:`, convError);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`KB ingestion complete. Processed: ${toProcess.length}, Snippets created: ${snippetsCreated}, Duration: ${duration}ms`);

    return new Response(
      JSON.stringify({
        processed: toProcess.length,
        snippetsCreated,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('KB ingestion error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
