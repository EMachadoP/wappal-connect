import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let msgIdForLog: string | null = null;
  let convIdForLog: string | null = null;

  try {
    const body = await req.json();
    const { message_id, audio_url, conversation_id } = body;
    msgIdForLog = message_id;
    convIdForLog = conversation_id;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[Transcribe] 🎤 Iniciando: ${message_id}`);

    if (!message_id || !audio_url) {
      throw new Error('message_id e audio_url são obrigatórios');
    }

    // Verificar se tem OpenAI Key
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY não configurada. Por favor, execute: npx supabase secrets set OPENAI_API_KEY="sua_chave"');
    }

    // Buscar token Z-API
    const { data: zapiSettings } = await supabaseAdmin
      .from('zapi_settings')
      .select('zapi_security_token')
      .maybeSingle();

    const zapiClientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') || zapiSettings?.zapi_security_token;

    // Download do áudio
    console.log(`[Transcribe] Baixando áudio...`);
    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'G7-Client-Connector/1.0'
    };

    if (zapiClientToken) {
      fetchHeaders['Client-Token'] = zapiClientToken;
    }

    const audioResponse = await fetch(audio_url, { headers: fetchHeaders });

    if (!audioResponse.ok) {
      throw new Error(`Download falhou: ${audioResponse.status}`);
    }

    const audioBlob = await audioResponse.blob();
    console.log(`[Transcribe] ✅ Baixado: ${audioBlob.size} bytes`);

    // Preparar FormData para OpenAI Transcription
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.ogg');
    // Usando o modelo gpt-4o-mini-transcribe para melhor custo (US$ 0,003/min)
    formData.append('model', 'gpt-4o-mini-transcribe');
    formData.append('language', 'pt');
    formData.append('response_format', 'json');

    console.log(`[Transcribe] Enviando para OpenAI (gpt-4o-mini-transcribe)...`);

    // Chamar OpenAI API
    let whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`
      },
      body: formData
    });

    // Fallback para whisper-1 se o modelo novo não estiver disponível
    if (whisperResponse.status === 404 || whisperResponse.status === 400) {
      console.log(`[Transcribe] gpt-4o-mini-transcribe não disponível. Tentando whisper-1...`);
      formData.set('model', 'whisper-1');
      whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`
        },
        body: formData
      });
    }

    console.log(`[Transcribe] Status Resposta: ${whisperResponse.status}`);

    if (!whisperResponse.ok) {
      const errText = await whisperResponse.text();
      console.error(`[Transcribe] Erro Whisper:`, errText);
      throw new Error(`Whisper API erro (${whisperResponse.status}): ${errText.substring(0, 200)}`);
    }

    const result = await whisperResponse.json();
    const transcript = result.text?.trim() || "";

    console.log(`[Transcribe] ✅ Transcrito: "${transcript.substring(0, 100)}..."`);

    // Atualizar mensagem
    const { error: updateError } = await supabaseAdmin
      .from('messages')
      .update({
        transcript: transcript || '[Sem áudio detectável]',
        content: transcript ? `🎤 ${transcript}` : '[Sem áudio detectável]',
        transcribed_at: new Date().toISOString(),
        transcript_provider: 'openai-whisper',
      })
      .eq('id', message_id);

    if (updateError) {
      throw updateError;
    }

    // Log sucesso
    await supabaseAdmin.from('ai_logs').insert({
      conversation_id,
      status: 'success',
      model: 'whisper-1',
      provider: 'openai',
      input_excerpt: `✅ ${transcript.substring(0, 100)}`
    });

    // Trigger IA
    if (conversation_id && transcript) {
      console.log('[Transcribe] Disparando IA...');
      await fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({ conversation_id }),
      }).catch(e => console.error('[Transcribe] Erro ao disparar IA:', e));
    }

    return new Response(JSON.stringify({
      success: true,
      transcript
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[Transcribe] ❌ ERRO:', error.message);

    try {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      await supabaseAdmin.from('ai_logs').insert({
        conversation_id: convIdForLog,
        status: 'error',
        error_message: error.message,
        model: 'whisper-1',
        provider: 'openai'
      });

      if (msgIdForLog) {
        await supabaseAdmin.from('messages').update({
          transcript: '[Erro na transcrição]',
          content: `[Áudio - ${error.message.substring(0, 50)}]`,
          transcribed_at: new Date().toISOString(),
          transcript_provider: 'error'
        }).eq('id', msgIdForLog);
      }
    } catch (logErr) {
      console.error('[Transcribe] Erro ao logar:', logErr);
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
