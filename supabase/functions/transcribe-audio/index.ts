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

  try {
    const { message_id, audio_url } = await req.json();
    
    if (!message_id || !audio_url) {
      return new Response(JSON.stringify({ 
        error: 'message_id and audio_url are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      console.error('OPENAI_API_KEY not configured');
      return new Response(JSON.stringify({ 
        error: 'Transcription service not configured' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log(`Transcribing audio for message ${message_id}:`, audio_url);
    
    // Download audio file
    const audioResponse = await fetch(audio_url);
    if (!audioResponse.ok) {
      console.error('Failed to download audio:', audioResponse.status);
      return new Response(JSON.stringify({ 
        error: 'Failed to download audio file' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const audioBlob = await audioResponse.blob();
    console.log(`Audio downloaded: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
    
    // Prepare form data for OpenAI Whisper API
    const formData = new FormData();
    
    // Determine file extension from content type or URL
    let extension = 'ogg';
    if (audio_url.includes('.mp3')) extension = 'mp3';
    else if (audio_url.includes('.m4a')) extension = 'm4a';
    else if (audio_url.includes('.wav')) extension = 'wav';
    else if (audioBlob.type.includes('mpeg')) extension = 'mp3';
    else if (audioBlob.type.includes('mp4')) extension = 'm4a';
    
    const file = new File([audioBlob], `audio.${extension}`, { type: audioBlob.type || 'audio/ogg' });
    formData.append('file', file);
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt'); // Portuguese
    formData.append('response_format', 'json');
    
    // Call OpenAI Whisper API
    console.log('Calling OpenAI Whisper API...');
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: formData,
    });
    
    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error('Whisper API error:', whisperResponse.status, errorText);
      return new Response(JSON.stringify({ 
        error: `Transcription failed: ${whisperResponse.status}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const whisperResult = await whisperResponse.json();
    const transcript = whisperResult.text?.trim() || '';
    
    console.log(`Transcription result for ${message_id}:`, transcript.substring(0, 100));
    
    if (!transcript) {
      console.log('Empty transcription result');
      return new Response(JSON.stringify({ 
        success: true,
        transcript: '',
        message: 'Audio was empty or inaudible',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Update message with transcript
    const { error: updateError } = await supabase
      .from('messages')
      .update({
        transcript: transcript,
        transcribed_at: new Date().toISOString(),
        transcript_provider: 'openai-whisper',
      })
      .eq('id', message_id);
    
    if (updateError) {
      console.error('Error updating message with transcript:', updateError);
      return new Response(JSON.stringify({ 
        error: 'Failed to save transcript',
        transcript, // Still return the transcript
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`Successfully transcribed message ${message_id}`);
    
    return new Response(JSON.stringify({
      success: true,
      transcript,
      message_id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Transcription error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
