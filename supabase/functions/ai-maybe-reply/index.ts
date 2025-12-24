import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id } = await req.json();
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[ai-maybe-reply] Processando:', conversation_id);

    // 1. Carregar dados da conversa e configurações
    const { data: conv } = await supabase
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', conversation_id)
      .single();

    if (!conv || conv.ai_mode === 'OFF') return new Response(JSON.stringify({ success: false, reason: 'IA OFF' }));

    // 2. Buscar histórico de mensagens
    const { data: msgs } = await supabase
      .from('messages')
      .select('content, sender_type')
      .eq('conversation_id', conversation_id)
      .order('sent_at', { ascending: false })
      .limit(10);

    const messages = (msgs || []).reverse().map(m => ({
      role: m.sender_type === 'contact' ? 'user' : 'assistant',
      content: m.content || '',
    }));

    // 3. Buscar prompt e configurações globais
    const { data: settings } = await supabase.from('ai_settings').select('*').single();
    
    let systemPrompt = settings?.base_system_prompt || "Você é um assistente virtual.";
    const variables: Record<string, string> = {
      '{{customer_name}}': conv.contacts?.name || 'Cliente',
      '{{timezone}}': settings?.timezone || 'America/Recife',
    };

    for (const [key, value] of Object.entries(variables)) {
      systemPrompt = systemPrompt.replace(new RegExp(key, 'g'), value);
    }

    // 4. Chamar geração da resposta
    console.log('[ai-maybe-reply] Chamando geração...');
    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/ai-generate-reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        messages: messages,
        systemPrompt: systemPrompt,
      }),
    });

    const aiData = await aiResponse.json();
    if (!aiData.text) throw new Error('IA não gerou texto');

    // 5. Enviar via Z-API
    console.log('[ai-maybe-reply] Enviando resposta via Z-API');
    await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        conversation_id,
        content: aiData.text,
        message_type: 'text',
        sender_name: 'Ana Mônica'
      }),
    });

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[ai-maybe-reply] Erro:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});