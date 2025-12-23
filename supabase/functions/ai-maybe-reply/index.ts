import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

// Audio transcription constants
const AUDIO_ACK_MESSAGE = "Recebi seu áudio 👍 Estou verificando aqui e já te retorno.";

// Transcribe audio using Lovable AI Gateway (Gemini)
// deno-lint-ignore no-explicit-any
async function transcribeAudio(
  supabase: any,
  mediaUrl: string,
  messageId: string
): Promise<{ transcript: string | null; error?: string }> {
  try {
    console.log('Transcribing audio from:', mediaUrl);
    
    // Download the audio file
    const audioResponse = await fetch(mediaUrl);
    if (!audioResponse.ok) {
      console.error('Failed to download audio:', audioResponse.status);
      return { transcript: null, error: 'Failed to download audio' };
    }
    
    const audioBlob = await audioResponse.blob();
    const audioBuffer = await audioBlob.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));
    const mimeType = audioResponse.headers.get('content-type') || 'audio/ogg';
    
    console.log('Audio downloaded, size:', audioBuffer.byteLength, 'type:', mimeType);
    
    // Use Lovable AI Gateway with Gemini Flash (supports audio)
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      console.error('LOVABLE_API_KEY not configured');
      return { transcript: null, error: 'API key not configured' };
    }
    
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
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcreva este áudio em português brasileiro. Retorne APENAS a transcrição, sem introduções, explicações ou comentários adicionais. Se não conseguir entender o áudio, retorne "[inaudível]".'
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: base64Audio,
                  format: mimeType.includes('mp3') ? 'mp3' : mimeType.includes('wav') ? 'wav' : 'ogg'
                }
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Transcription API error:', response.status, errorText);
      return { transcript: null, error: `API error: ${response.status}` };
    }
    
    const result = await response.json();
    const transcript = result.choices?.[0]?.message?.content?.trim() || null;
    
    console.log('Transcription result:', transcript?.substring(0, 100));
    
    // Save transcript to message using raw SQL to avoid type issues
    if (transcript) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      
      await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          transcript,
          transcribed_at: new Date().toISOString(),
          transcript_provider: 'gemini-2.5-flash',
        }),
      });
    }
    
    return { transcript };
  } catch (error) {
    console.error('Transcription error:', error);
    return { transcript: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

interface DaySchedule {
  enabled: boolean;
  start: string;
  end: string;
}

interface ScheduleException {
  date: string;
  enabled: boolean;
  message?: string;
}

interface ScheduleJson {
  days: {
    monday: DaySchedule;
    tuesday: DaySchedule;
    wednesday: DaySchedule;
    thursday: DaySchedule;
    friday: DaySchedule;
    saturday: DaySchedule;
    sunday: DaySchedule;
  };
  exceptions: ScheduleException[];
}

interface ThrottlingJson {
  anti_spam_seconds: number | null;
  max_messages_per_hour: number | null;
}

// Bot detection patterns
const BOT_PATTERNS = [
  /digite\s*\d/i,
  /opção\s*\d/i,
  /pressione\s*\d/i,
  /menu\s*principal/i,
  /voltar\s*ao\s*menu/i,
  /atendimento\s*automático/i,
  /aguarde\s*um\s*momento/i,
  /sua\s*chamada\s*é\s*muito\s*importante/i,
  /^[1-9]$/,
  /^\*[1-9]\*$/,
  /obrigad[oa]\s*por\s*entrar\s*em\s*contato/i,
  /em\s*que\s*posso\s*ajudar/i,
  /nosso\s*horário\s*de\s*atendimento/i,
];

const SAFE_BOT_RESPONSE = "Olá! Preciso falar com um responsável humano para seguir com o atendimento. Poderia chamar alguém, por favor?";

function calculateBotLikelihood(messages: { content: string; sender_type: string; sent_at: string }[]): number {
  const inboundMessages = messages.filter(m => m.sender_type === 'contact');
  if (inboundMessages.length < 3) return 0;

  let score = 0;
  let patternMatches = 0;
  let repetitions = 0;
  const contentSet = new Set<string>();

  // Check for bot patterns
  for (const msg of inboundMessages) {
    const content = msg.content || '';
    
    // Check patterns
    for (const pattern of BOT_PATTERNS) {
      if (pattern.test(content)) {
        patternMatches++;
        break;
      }
    }
    
    // Check repetitions
    const normalized = content.toLowerCase().trim();
    if (contentSet.has(normalized)) {
      repetitions++;
    }
    contentSet.add(normalized);
  }

  // Calculate frequency (messages per minute in last 5 messages)
  const recent = inboundMessages.slice(-5);
  if (recent.length >= 3) {
    const first = new Date(recent[0].sent_at).getTime();
    const last = new Date(recent[recent.length - 1].sent_at).getTime();
    const minutes = (last - first) / 60000;
    if (minutes > 0 && recent.length / minutes > 2) {
      score += 0.3; // High frequency
    }
  }

  // Score calculation
  score += Math.min(patternMatches * 0.2, 0.4);
  score += Math.min(repetitions * 0.15, 0.3);

  return Math.min(score, 1.0);
}

function isWithinSchedule(schedule: ScheduleJson, timezone: string): { allowed: boolean; exception?: ScheduleException } {
  const now = new Date();
  
  // Format date in timezone
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: timezone, 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  });
  const todayStr = formatter.format(now);
  
  // Check exceptions first
  const exception = schedule.exceptions?.find(e => e.date === todayStr);
  if (exception) {
    return { allowed: exception.enabled, exception };
  }
  
  // Get day of week in timezone
  const dayFormatter = new Intl.DateTimeFormat('en-US', { 
    timeZone: timezone, 
    weekday: 'long' 
  });
  const dayName = dayFormatter.format(now).toLowerCase() as keyof typeof schedule.days;
  
  const daySchedule = schedule.days[dayName];
  if (!daySchedule?.enabled) {
    return { allowed: false };
  }
  
  // Get current time in timezone
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const currentTime = timeFormatter.format(now);
  
  // Compare times
  const isWithinHours = currentTime >= daySchedule.start && currentTime <= daySchedule.end;
  return { allowed: isWithinHours };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Validate internal call - this function should only be called by other edge functions
    const internalSecret = req.headers.get('X-Internal-Secret') || req.headers.get('x-internal-secret');
    const authHeader = req.headers.get('Authorization');
    
    // Accept calls with service role key (internal) or valid internal secret
    const isValidInternalCall = internalSecret === supabaseServiceKey || 
      (authHeader && authHeader.replace('Bearer ', '') === supabaseServiceKey);
    
    if (!isValidInternalCall) {
      console.log('Unauthorized: ai-maybe-reply must be called internally');
      return new Response(
        JSON.stringify({ success: false, reason: 'unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { conversation_id } = await req.json();

    if (!conversation_id) {
      return new Response(
        JSON.stringify({ success: false, reason: 'conversation_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('AI maybe reply for conversation:', conversation_id);

    // Get conversation with contact
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.error('Conversation not found:', convError);
      return new Response(
        JSON.stringify({ success: false, reason: 'conversation_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CHECK AI MODE - if OFF, don't reply
    if (conversation.ai_mode === 'OFF') {
      console.log('AI is OFF for this conversation');
      return new Response(
        JSON.stringify({ success: false, reason: 'ai_mode_off' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CHECK HUMAN CONTROL - if human is in control and typing lock active
    if (conversation.human_control && conversation.typing_lock_until) {
      const typingLockUntil = new Date(conversation.typing_lock_until);
      if (typingLockUntil > new Date()) {
        console.log('Human is typing, AI blocked');
        return new Response(
          JSON.stringify({ success: false, reason: 'human_typing' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // CHECK SUPPLIER - if contact has role='fornecedor' or tag 'fornecedor', disable AI
    const contact = conversation.contacts;
    let isSupplier = false;
    
    if (contact?.id) {
      // Check participant role
      const { data: participantData } = await supabase
        .from('participants')
        .select('role_type')
        .eq('contact_id', contact.id)
        .eq('is_primary', true)
        .single();
      
      if (participantData?.role_type === 'fornecedor') {
        isSupplier = true;
      }
      
      // Check tags
      const tags = contact.tags || [];
      if (tags.includes('fornecedor') || tags.includes('supplier')) {
        isSupplier = true;
      }
    }

    if (isSupplier && conversation.ai_mode !== 'COPILOT') {
      console.log('Supplier detected, disabling AI');
      
      // Set AI mode to OFF
      await supabase
        .from('conversations')
        .update({ ai_mode: 'OFF' })
        .eq('id', conversation_id);
      
      // Log event
      await supabase.from('ai_events').insert({
        conversation_id,
        event_type: 'supplier_detected',
        message: '🏷️ FORNECEDOR — IA desativada.',
      });
      
      return new Response(
        JSON.stringify({ success: false, reason: 'supplier_detected' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get global AI settings
    const { data: settings, error: settingsError } = await supabase
      .from('ai_settings')
      .select('*')
      .limit(1)
      .single();

    if (settingsError || !settings) {
      console.log('No AI settings found');
      return new Response(
        JSON.stringify({ success: false, reason: 'no_ai_settings' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if AI is globally enabled
    if (!settings.enabled_global) {
      console.log('AI is globally disabled');
      return new Response(
        JSON.stringify({ success: false, reason: 'ai_disabled_global' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get team settings if conversation has assigned agent with team
    let teamSettings = null;
    if (conversation.assigned_to) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('team_id')
        .eq('id', conversation.assigned_to)
        .single();

      if (profile?.team_id) {
        const { data: ts } = await supabase
          .from('ai_team_settings')
          .select('*')
          .eq('team_id', profile.team_id)
          .single();
        
        teamSettings = ts;
      }
    }

    // Check if team has AI disabled
    if (teamSettings && !teamSettings.enabled) {
      console.log('AI disabled for team');
      return new Response(
        JSON.stringify({ success: false, reason: 'ai_disabled_team' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if conversation has human attending
    if (conversation.assigned_to && conversation.status === 'open') {
      // Check if last message was from agent (human is attending)
      const { data: lastAgentMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('conversation_id', conversation_id)
        .eq('sender_type', 'agent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (lastAgentMsg) {
        const lastAgentTime = new Date(lastAgentMsg.sent_at).getTime();
        const now = Date.now();
        const hourAgo = now - (60 * 60 * 1000);
        
        // If agent responded within the last hour, don't auto-reply
        if (lastAgentTime > hourAgo) {
          console.log('Human agent recently active, skipping AI');
          return new Response(
            JSON.stringify({ success: false, reason: 'human_attending' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Get or create conversation state
    let { data: convState } = await supabase
      .from('ai_conversation_state')
      .select('*')
      .eq('conversation_id', conversation_id)
      .single();

    if (!convState) {
      const { data: newState } = await supabase
        .from('ai_conversation_state')
        .insert({ conversation_id })
        .select()
        .single();
      convState = newState;
    }

    // Check if AI is paused for this conversation
    if (convState?.ai_paused_until) {
      const pausedUntil = new Date(convState.ai_paused_until);
      if (pausedUntil > new Date()) {
        console.log('AI paused for conversation until:', pausedUntil);
        return new Response(
          JSON.stringify({ success: false, reason: 'ai_paused', until: pausedUntil }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Check schedule - Priority: teamSettings > global settings > 24/7 default
    // First check if settings has a schedule_json, otherwise use 24/7 as fallback
    const globalSchedule = settings.schedule_json || {
      days: {
        monday: { enabled: true, start: '00:00', end: '23:59' },
        tuesday: { enabled: true, start: '00:00', end: '23:59' },
        wednesday: { enabled: true, start: '00:00', end: '23:59' },
        thursday: { enabled: true, start: '00:00', end: '23:59' },
        friday: { enabled: true, start: '00:00', end: '23:59' },
        saturday: { enabled: true, start: '00:00', end: '23:59' },
        sunday: { enabled: true, start: '00:00', end: '23:59' },
      },
      exceptions: [],
    };
    
    // Use team settings schedule if available, otherwise use global schedule
    const schedule = (teamSettings?.schedule_json || globalSchedule) as ScheduleJson;

    const scheduleResult = isWithinSchedule(schedule, settings.timezone);

    if (!scheduleResult.allowed) {
      console.log('Outside of schedule');
      
      // Send fallback message if configured
      const fallbackMessage = scheduleResult.exception?.message || settings.fallback_offhours_message;
      
      if (fallbackMessage) {
        // Check if we already sent a fallback recently (last 4 hours)
        const { data: recentFallback } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversation_id)
          .eq('sender_type', 'agent')
          .eq('content', fallbackMessage)
          .gte('sent_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (!recentFallback || recentFallback.length === 0) {
          // Send fallback message via zapi
          await supabase.functions.invoke('zapi-send-message', {
            body: {
              conversationId: conversation_id,
              message: fallbackMessage,
            },
          });

          // Log the fallback
          await supabase.from('ai_logs').insert({
            conversation_id,
            team_id: teamSettings?.team_id,
            provider: 'system',
            model: 'fallback',
            output_text: fallbackMessage,
            status: 'success',
          });
        }
      }

      return new Response(
        JSON.stringify({ success: false, reason: 'outside_schedule', fallback_sent: !!fallbackMessage }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check throttling
    const throttling = (teamSettings?.throttling_json || {}) as ThrottlingJson;
    const antiSpamSeconds = throttling.anti_spam_seconds || settings.anti_spam_seconds;
    const maxMessagesPerHour = throttling.max_messages_per_hour || settings.max_messages_per_hour;

    // Anti-spam: avoid multiple AI auto-replies in a short window
    // NOTE: We check the last AI log (not the last customer message), otherwise an immediate trigger
    // right after saving the customer message would always be blocked.
    if (antiSpamSeconds && antiSpamSeconds > 0) {
      const { data: lastAiLog } = await supabase
        .from('ai_logs')
        .select('created_at')
        .eq('conversation_id', conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastAiLog?.created_at) {
        const lastAiTime = new Date(lastAiLog.created_at).getTime();
        const now = Date.now();

        if (now - lastAiTime < antiSpamSeconds * 1000) {
          console.log('Anti-spam: AI recently replied');
          return new Response(
            JSON.stringify({ success: false, reason: 'anti_spam' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Check hourly limit
    const windowStart = convState?.window_started_at ? new Date(convState.window_started_at) : new Date();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    if (windowStart < hourAgo) {
      // Reset window
      await supabase
        .from('ai_conversation_state')
        .update({ 
          auto_msg_count_window: 0, 
          window_started_at: new Date().toISOString() 
        })
        .eq('conversation_id', conversation_id);
      convState!.auto_msg_count_window = 0;
    }

    if (convState!.auto_msg_count_window >= maxMessagesPerHour) {
      console.log('Hourly limit reached');
      return new Response(
        JSON.stringify({ success: false, reason: 'hourly_limit' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // HARD LIMIT: max 5 auto messages in 2 minutes
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recentAutoMsgs } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation_id)
      .eq('sender_type', 'agent')
      .is('sender_id', null) // AI messages have no sender_id
      .gte('sent_at', twoMinAgo);

    if (recentAutoMsgs && recentAutoMsgs.length >= 5) {
      console.log('Hard limit: 5 auto messages in 2 minutes');
      
      // Pause AI
      await supabase
        .from('conversations')
        .update({ 
          ai_mode: 'OFF',
          ai_paused_until: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        })
        .eq('id', conversation_id);
      
      await supabase.from('ai_events').insert({
        conversation_id,
        event_type: 'hard_limit_reached',
        message: '🛑 Limite de 5 msgs automáticas em 2 min — IA pausada.',
      });
      
      return new Response(
        JSON.stringify({ success: false, reason: 'hard_limit_2min' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // HARD LIMIT: max 3 consecutive auto messages without human inbound
    const { data: lastMsgs } = await supabase
      .from('messages')
      .select('sender_type, sender_id')
      .eq('conversation_id', conversation_id)
      .order('sent_at', { ascending: false })
      .limit(6);

    let consecutiveAutoMsgs = 0;
    for (const msg of (lastMsgs || [])) {
      if (msg.sender_type === 'agent' && !msg.sender_id) {
        consecutiveAutoMsgs++;
      } else {
        break;
      }
    }

    if (consecutiveAutoMsgs >= 3) {
      console.log('Hard limit: 3 consecutive auto messages');
      
      await supabase.from('ai_events').insert({
        conversation_id,
        event_type: 'consecutive_limit_reached',
        message: '🛑 3 msgs automáticas seguidas sem resposta humana — IA pausada.',
      });
      
      // Update state
      await supabase
        .from('ai_conversation_state')
        .update({ consecutive_auto_msgs: consecutiveAutoMsgs })
        .eq('conversation_id', conversation_id);
      
      return new Response(
        JSON.stringify({ success: false, reason: 'consecutive_limit' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== AUDIO TRANSCRIPTION CHECK ==========
    // Get the last inbound message to check if it's audio
    const { data: lastInboundMsg } = await supabase
      .from('messages')
      .select('id, message_type, media_url, content')
      .eq('conversation_id', conversation_id)
      .eq('sender_type', 'contact')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    // Check if last message is audio and needs transcription
    if (lastInboundMsg?.message_type === 'audio' && lastInboundMsg.media_url) {
      console.log('Last message is audio, checking for transcript');
      
      // Check if already transcribed (stored in message)
      const { data: msgWithTranscript } = await supabase
        .from('messages')
        .select('*')
        .eq('id', lastInboundMsg.id)
        .single();
      
      // Access transcript via raw data since types not updated yet
      const rawMsg = msgWithTranscript as Record<string, unknown>;
      const existingTranscript = rawMsg?.transcript as string | null;
      
      if (!existingTranscript) {
        console.log('Audio needs transcription');
        
        // Send acknowledgment message first
        await supabase.functions.invoke('zapi-send-message', {
          body: {
            conversation_id: conversation_id,
            content: AUDIO_ACK_MESSAGE,
            message_type: 'text',
            sender_name: 'Ana Mônica',
          },
        });
        
        // Transcribe the audio
        const { transcript, error: transcriptError } = await transcribeAudio(
          supabase,
          lastInboundMsg.media_url,
          lastInboundMsg.id
        );
        
        if (transcriptError || !transcript) {
          console.error('Failed to transcribe audio:', transcriptError);
          // Continue without transcript - AI will respond based on context
        } else {
          console.log('Audio transcribed successfully');
        }
      }
    }

    // Get conversation history (now includes transcript if just added)
    const { data: messages } = await supabase
      .from('messages')
      .select('id, content, sender_type, sent_at, message_type, media_url')
      .eq('conversation_id', conversation_id)
      .order('sent_at', { ascending: false })
      .limit(settings.memory_message_count);

    // Get transcripts for audio messages (raw query to handle new columns)
    const audioMessageIds = (messages || [])
      .filter(m => m.message_type === 'audio')
      .map(() => ''); // We'll fetch all messages with transcripts
    
    // Fetch messages with transcripts using REST API to avoid type issues
    let transcriptMap: Record<string, string> = {};
    if (audioMessageIds.length > 0) {
      try {
        const transcriptResponse = await fetch(
          `${supabaseUrl}/rest/v1/messages?conversation_id=eq.${conversation_id}&message_type=eq.audio&select=id,transcript`,
          {
            headers: {
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
          }
        );
        const transcriptData = await transcriptResponse.json();
        for (const item of transcriptData || []) {
          if (item.transcript) {
            transcriptMap[item.id] = item.transcript;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch transcripts:', e);
      }
    }

    // BOT DETECTION (Anti-loop)
    const botLikelihood = calculateBotLikelihood(messages || []);
    console.log('Bot likelihood:', botLikelihood);

    if (botLikelihood >= 0.6) {
      console.log('Bot detected, pausing AI');
      
      // Update conversation
      await supabase
        .from('conversations')
        .update({ ai_mode: 'OFF' })
        .eq('id', conversation_id);
      
      // Update state
      await supabase
        .from('ai_conversation_state')
        .update({ 
          bot_likelihood: botLikelihood,
          bot_detection_triggered: true
        })
        .eq('conversation_id', conversation_id);
      
      // Add tag to contact
      if (contact?.id) {
        const existingTags = contact.tags || [];
        if (!existingTags.includes('suspeita_bot')) {
          await supabase
            .from('contacts')
            .update({ tags: [...existingTags, 'suspeita_bot'] })
            .eq('id', contact.id);
        }
      }
      
      // Log event
      await supabase.from('ai_events').insert({
        conversation_id,
        event_type: 'bot_detected',
        message: '🛑 Possível bot do outro lado — IA pausada.',
        metadata: { bot_likelihood: botLikelihood },
      });
      
      // Send safe response (only once)
      const { data: existingSafeResponse } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversation_id)
        .eq('content', SAFE_BOT_RESPONSE)
        .limit(1);
      
      if (!existingSafeResponse || existingSafeResponse.length === 0) {
        await supabase.functions.invoke('zapi-send-message', {
          body: {
            conversation_id: conversation_id,
            content: SAFE_BOT_RESPONSE,
            message_type: 'text',
          },
        });
      }
      
      return new Response(
        JSON.stringify({ success: false, reason: 'bot_detected', bot_likelihood: botLikelihood }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build conversation history, using transcripts for audio messages
    const conversationHistory = (messages || [])
      .reverse()
      .filter(m => m.content)
      .map(m => {
        // For audio messages, use transcript if available
        let messageContent = m.content!;
        
        if (m.message_type === 'audio') {
          // Check if we have a transcript for this message
          const transcript = m.id ? transcriptMap[m.id] : null;
          if (transcript) {
            messageContent = `[Áudio transcrito]: ${transcript}`;
          } else if (m.content.includes('🎤 Áudio')) {
            // Audio without transcript - indicate it's an audio
            messageContent = '[Mensagem de áudio não transcrita]';
          }
        }
        
        return {
          role: m.sender_type === 'contact' ? 'user' : 'assistant',
          content: messageContent,
        };
      });

    // Check if customer requested human
    const lastUserMessage = conversationHistory[conversationHistory.length - 1];
    if (lastUserMessage) {
      const humanKeywords = ['humano', 'atendente', 'pessoa', 'agente', 'operador', 'human'];
      const wantsHuman = humanKeywords.some(kw => 
        lastUserMessage.content.toLowerCase().includes(kw)
      );

      if (wantsHuman) {
        console.log('Customer requested human');
        
        // Pause AI for this conversation
        const pauseHours = settings.human_request_pause_hours || 2;
        await supabase
          .from('ai_conversation_state')
          .update({
            ai_paused_until: new Date(Date.now() + pauseHours * 60 * 60 * 1000).toISOString(),
            ai_disabled_reason: 'customer_requested_human',
          })
          .eq('conversation_id', conversation_id);

        // Update conversation priority
        await supabase
          .from('conversations')
          .update({ priority: 'high', marked_unread: true })
          .eq('id', conversation_id);

        return new Response(
          JSON.stringify({ success: false, reason: 'customer_wants_human' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Build system prompt with variables
    let systemPrompt = teamSettings?.prompt_override || settings.base_system_prompt;
    
    // contact already defined above from conversation.contacts
    
    // Fetch participant info for context
    let participantContext = '';
    let shouldUsePersonalName = true;
    let isPortaria = false; // Flag for doorman/reception - neutral greeting without name
    let isAdministradora = false; // Flag for building management companies
    let participantRole = '';
    
    if (contact?.id) {
      // Get primary participant for this contact
      const { data: participantData } = await supabase
        .from('participants')
        .select('*, entities:entity_id(id, name, type)')
        .eq('contact_id', contact.id)
        .eq('is_primary', true)
        .limit(1)
        .single();

      // Get conversation participant state
      const { data: convParticipantState } = await supabase
        .from('conversation_participant_state')
        .select('*')
        .eq('conversation_id', conversation_id)
        .single();

      // Check display name type
      let displayNameType = 'UNKNOWN';
      if (contact.whatsapp_display_name) {
        const { data: typeResult } = await supabase
          .rpc('detect_display_name_type', { display_name: contact.whatsapp_display_name });
        displayNameType = typeResult || 'UNKNOWN';
      }

      // Check for special roles/tags that require different greeting behavior
      const tags = (contact.tags || []).map((t: string) => t.toLowerCase());
      const PORTARIA_ROLES = ['porteiro', 'portaria', 'recepcionista', 'recepção', 'recepcao', 'vigilante', 'segurança', 'seguranca'];
      const ADMINISTRADORA_ROLES = ['administradora', 'administrador', 'gestora', 'gestor', 'síndica', 'sindica', 'síndico', 'sindico'];
      
      // Check tags first
      isPortaria = PORTARIA_ROLES.some(role => tags.includes(role));
      isAdministradora = ADMINISTRADORA_ROLES.some(role => tags.includes(role));
      
      // Check participant role_type
      if (participantData?.role_type) {
        const roleNormalized = participantData.role_type.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        participantRole = participantData.role_type;
        
        if (PORTARIA_ROLES.some(r => roleNormalized.includes(r.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) {
          isPortaria = true;
        }
        if (ADMINISTRADORA_ROLES.some(r => roleNormalized.includes(r.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) {
          isAdministradora = true;
        }
      }

      // Build context header
      participantContext = `
--- CONTEXTO DO CONTATO ---
Telefone: ${contact.phone || 'N/A'}
Nome WhatsApp: ${contact.whatsapp_display_name || 'N/A'} (${displayNameType === 'ENTITY_NAME' ? 'Nome de entidade - NÃO usar como nome pessoal' : 'Possível nome pessoal'})
Tags: ${(contact.tags || []).join(', ') || 'Nenhuma'}
`;

      // Special greeting rules based on role
      if (isPortaria) {
        participantContext += `
--- REGRA DE SAUDAÇÃO: PORTARIA ---
IMPORTANTE: Este contato é de uma PORTARIA (possivelmente revezamento de porteiros).
- NÃO use nome pessoal na saudação
- Use saudação neutra: "Bom dia/Boa tarde/Boa noite! Em que posso ajudar?"
- Só peça o nome quando precisar abrir protocolo: "Para registrar o chamado, posso anotar seu nome? (Se preferir, pode ser só 'Portaria')."
`;
        shouldUsePersonalName = false;
      }

      if (isAdministradora) {
        participantContext += `
--- REGRA DE SAUDAÇÃO: ADMINISTRADORA ---
IMPORTANTE: Este contato é de uma ADMINISTRADORA que pode atender múltiplos condomínios.
- Sempre pergunte qual condomínio quando houver dúvida
- Use tratamento formal mas sem nome
`;
      }

      if (participantData) {
        const entity = participantData.entities as { id: string; name: string; type: string } | null;
        participantContext += `
--- IDENTIDADE CONFIRMADA ---
Nome: ${participantData.name}
Função: ${participantData.role_type || 'N/A'}
Entidade: ${entity?.name || 'N/A'}
Confiança: ${Math.round(participantData.confidence * 100)}%
`;
        // Use personal name only if:
        // 1. Confidence is high enough
        // 2. NOT a portaria role (they may be different people sharing the phone)
        shouldUsePersonalName = participantData.confidence >= 0.7 && !isPortaria;
      } else {
        participantContext += `
--- IDENTIDADE NÃO CONFIRMADA ---
O remetente ainda não foi identificado. NÃO use nomes pessoais até que a identidade seja confirmada.
`;
        shouldUsePersonalName = false;
      }

      // Check if we need to ask for identification
      if (!participantData && (!convParticipantState || !convParticipantState.identification_asked)) {
        // Different prompt for portaria vs other contacts
        if (isPortaria) {
          participantContext += `
INSTRUÇÃO: Na saudação use: "Bom dia/Boa tarde/Boa noite! Em que posso ajudar?"
NÃO pergunte nome inicialmente - só peça quando precisar registrar um protocolo.
`;
        } else {
          participantContext += `
INSTRUÇÃO: Na próxima resposta, pergunte educadamente: "Por gentileza, poderia me informar seu nome, de qual condomínio/empresa fala e qual sua função?"
Após perguntar, isso será registrado e não precisará perguntar novamente.
`;
        }
        // Mark that we asked (or skipped for portaria)
        await supabase
          .from('conversation_participant_state')
          .upsert({
            conversation_id,
            identification_asked: true,
          }, { onConflict: 'conversation_id' });
      }
    }

    const variables: Record<string, string> = {
      '{{customer_name}}': shouldUsePersonalName ? (contact?.name || 'Cliente') : 'Cliente',
      '{{timezone}}': settings.timezone,
      '{{business_hours}}': 'Seg-Sex 08:00-18:00, Sáb 08:00-12:00',
      '{{policies}}': JSON.stringify(settings.policies_json || {}),
      '{{participant_context}}': participantContext,
    };

    for (const [key, value] of Object.entries(variables)) {
      systemPrompt = systemPrompt.replace(new RegExp(key, 'g'), value);
    }

    // Prepend participant context to system prompt if not using variable
    if (!systemPrompt.includes('{{participant_context}}') && participantContext) {
      systemPrompt = participantContext + '\n\n' + systemPrompt;
    }

    // Call AI generate function
    const { data: aiResponse, error: aiError } = await supabase.functions.invoke('ai-generate-reply', {
      body: {
        messages: conversationHistory,
        systemPrompt,
      },
    });

    if (aiError || !aiResponse || aiResponse.error) {
      console.error('AI generation failed:', aiError || aiResponse?.error);
      
      // Log error
      await supabase.from('ai_logs').insert({
        conversation_id,
        team_id: teamSettings?.team_id,
        provider: 'unknown',
        model: 'unknown',
        status: 'error',
        error_message: aiError?.message || aiResponse?.error,
      });

      return new Response(
        JSON.stringify({ success: false, reason: 'ai_error', error: aiError?.message || aiResponse?.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SANITIZE AI RESPONSE - Remove any internal/debug content that shouldn't go to WhatsApp
    let sanitizedResponse = aiResponse.text || '';
    
    // Patterns to detect and remove internal content
    const internalPatterns = [
      // Structured fields that shouldn't be in WhatsApp messages
      /\*{0,2}(Condomínio|Apartamento|Contato|Problema|Status|Data|Função de quem fala|Chamado de Unidade|Chamado Geral):\*{0,2}\s*\[?[^\n\]]*\]?/gi,
      // D+0/D+1 technical references
      /\b(D\+[01]|Crítico|Agendado D\+1|CRÍTICO \(mesmo dia\))\b/gi,
      // Correction notes
      /\*?Correction[^*\n]*\*?/gi,
      // Any remaining ** field markers
      /\*\*(Status|Data|Problema|Condomínio|Apartamento):\*\*[^\n]*/gi,
      // Stray asterisks at end
      /\n\s*\*\s*$/g,
      // Empty lines with just asterisks or formatting
      /\n\s*\*{1,2}\s*\n/g,
      // English technical terms that shouldn't appear
      /\b(not critical|is D\+1|Correction on status)\b/gi,
      // Block headers like "Resumo do Chamado"
      /\n?-*\s*(Resumo do Chamado|Chamado de Unidade|Chamado Geral)\s*-*\n?/gi,
      // Lines that look like structured data
      /^\s*(Condomínio|Apartamento|Contato|Status|Data|Problema|Função):\s*.*$/gim,
    ];

    for (const pattern of internalPatterns) {
      sanitizedResponse = sanitizedResponse.replace(pattern, '');
    }

    // Clean up multiple newlines and trim
    sanitizedResponse = sanitizedResponse
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '')
      .trim();

    // If sanitization removed everything, don't send empty message
    if (!sanitizedResponse || sanitizedResponse.length < 5) {
      console.log('Sanitized response too short, skipping send:', sanitizedResponse);
      return new Response(
        JSON.stringify({ success: false, reason: 'empty_after_sanitization' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Sending sanitized AI response:', sanitizedResponse.substring(0, 200));

    // DETECT PROTOCOL CREATION - When AI says "Chamado registrado" or similar
    const protocolCreationPatterns = [
      /chamado\s+registrado/i,
      /protocolo\s*:\s*G7-/i,
      /vou\s+registrar\s+o\s+chamado/i,
    ];
    
    const isCreatingProtocol = protocolCreationPatterns.some(p => p.test(sanitizedResponse));
    
    if (isCreatingProtocol && conversation) {
      console.log('Detected protocol creation in AI response, triggering protocol-opened');
      
      try {
        // Generate protocol code
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        
        // Get next sequence for today
        const { data: existingProtocols } = await supabase
          .from('protocols')
          .select('protocol_code')
          .like('protocol_code', `G7-${dateStr}-%`);
        
        const nextSeq = (existingProtocols?.length || 0) + 1;
        const protocolCode = `G7-${dateStr}-${String(nextSeq).padStart(4, '0')}`;
        
        // ========== BUSCAR DADOS ESTRUTURADOS (PRIORIDADE) ==========
        
        // 1. Buscar condomínio do active_condominium_id da conversa
        let condominiumName = 'Não identificado';
        let condominiumId: string | null = conversation.active_condominium_id || null;
        
        if (condominiumId) {
          // Tentar buscar de entities primeiro
          const { data: entityData } = await supabase
            .from('entities')
            .select('name')
            .eq('id', condominiumId)
            .single();
          
          if (entityData?.name) {
            condominiumName = entityData.name;
          } else {
            // Fallback para condominiums table
            const { data: condoData } = await supabase
              .from('condominiums')
              .select('name')
              .eq('id', condominiumId)
              .single();
            
            if (condoData?.name) {
              condominiumName = condoData.name;
            }
          }
        }
        
        // 2. Buscar solicitante do conversation_participant_state
        let requesterName = 'Não identificado';
        let requesterRole = 'Não informado';
        let participantId: string | null = null;
        
        const { data: participantState } = await supabase
          .from('conversation_participant_state')
          .select('current_participant_id')
          .eq('conversation_id', conversation_id)
          .maybeSingle();
        
        if (participantState?.current_participant_id) {
          participantId = participantState.current_participant_id;
          
          const { data: participantData } = await supabase
            .from('participants')
            .select('name, role_type, entity_id, entities:entity_id(name)')
            .eq('id', participantId)
            .single();
          
          if (participantData) {
            requesterName = participantData.name || requesterName;
            requesterRole = participantData.role_type || requesterRole;
            
            // Se não temos condomínio ainda, pegar do participant
            if (condominiumName === 'Não identificado' && participantData.entities) {
              const entities = participantData.entities as unknown;
              const entityInfo = Array.isArray(entities) ? entities[0] : entities;
              if (entityInfo && typeof entityInfo === 'object' && 'name' in entityInfo) {
                condominiumName = (entityInfo as { name: string }).name;
              }
            }
          }
        } else {
          // Fallback: buscar participante primário do contato
          if (contact?.id) {
            const { data: primaryParticipant } = await supabase
              .from('participants')
              .select('id, name, role_type, entity_id, entities:entity_id(name)')
              .eq('contact_id', contact.id)
              .eq('is_primary', true)
              .single();
            
            if (primaryParticipant) {
              participantId = primaryParticipant.id;
              requesterName = primaryParticipant.name || requesterName;
              requesterRole = primaryParticipant.role_type || requesterRole;
              
              if (condominiumName === 'Não identificado' && primaryParticipant.entities) {
                const entities = primaryParticipant.entities as unknown;
                const entityInfo = Array.isArray(entities) ? entities[0] : entities;
                if (entityInfo && typeof entityInfo === 'object' && 'name' in entityInfo) {
                  condominiumName = (entityInfo as { name: string }).name;
                }
              }
            }
          }
        }
        
        // 3. Fallback: tentar extrair do contato
        if (requesterName === 'Não identificado' && contact?.name) {
          requesterName = contact.name;
        }
        
        // 4. Se ainda não temos condomínio, tentar de contact_condominiums (default)
        if (condominiumName === 'Não identificado' && contact?.id) {
          const { data: contactCondo } = await supabase
            .from('contact_condominiums')
            .select('condominiums:condominium_id(id, name)')
            .eq('contact_id', contact.id)
            .eq('is_default', true)
            .single();
          
          if (contactCondo?.condominiums) {
            const condos = contactCondo.condominiums as unknown;
            const condo = Array.isArray(condos) ? condos[0] : condos;
            if (condo && typeof condo === 'object' && 'name' in condo && 'id' in condo) {
              condominiumName = (condo as { name: string }).name;
              condominiumId = (condo as { id: string }).id;
            }
          }
        }
        
        // ========== DETERMINAR CATEGORIA E PRIORIDADE ==========
        let category = 'operational';
        let priority = 'normal';
        const fullHistory = conversationHistory.map(m => m.content).join(' ').toLowerCase();
        
        // Detect category
        if (/interfone|tv|antena|controle|tag|cartão/i.test(fullHistory)) {
          category = 'support';
        }
        if (/boleto|nota|cobrança|fatura|pagamento/i.test(fullHistory)) {
          category = 'financial';
        }
        if (/orçamento|contrato|proposta|valor/i.test(fullHistory)) {
          category = 'commercial';
        }
        
        // Detect priority (critical if gate/fence/cftv completely down)
        if (/não\s+(abre|funciona|liga)|travad[oa]|fora\s+do\s+ar|inoperante|todas\s+as\s+câmeras/i.test(fullHistory)) {
          if (/portão|cerca|cftv|câmera/i.test(fullHistory)) {
            priority = 'critical';
          }
        }
        
        // Build summary from last user messages (customer_text para auditoria)
        const userMsgs = conversationHistory.filter(m => m.role === 'user');
        const customerText = userMsgs.slice(-3).map(m => m.content).join('\n\n');
        const summary = customerText.substring(0, 500);
        
        console.log('Protocol data (structured):', { 
          protocolCode, 
          condominiumName, 
          requesterName, 
          requesterRole, 
          category, 
          priority,
          participantId 
        });
        
        // Create protocol directly in database first (most reliable)
        const protocolInsertData: Record<string, unknown> = {
          protocol_code: protocolCode,
          conversation_id: conversation_id,
          contact_id: contact?.id,
          condominium_id: condominiumId,
          status: 'open',
          priority: priority || 'normal',
          category: category || 'operational',
          summary,
          requester_name: requesterName,
          requester_role: requesterRole,
          created_by_type: 'ai',
          customer_text: customerText,
          participant_id: participantId,
        };

        const { data: newProtocol, error: protocolInsertError } = await supabase
          .from('protocols')
          .insert(protocolInsertData as Record<string, unknown>)
          .select()
          .single();

        if (protocolInsertError) {
          console.error('Error inserting protocol:', protocolInsertError);
        } else {
          console.log('Protocol created:', newProtocol.id, protocolCode);
          
          // Update conversation with protocol code
          await supabase
            .from('conversations')
            .update({ protocol: protocolCode })
            .eq('id', conversation_id);
          
          // Trigger integrations (Asana, WhatsApp) in background
          const protocolUrl = `${supabaseUrl}/functions/v1/protocol-opened`;
          fetch(protocolUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              protocol_id: newProtocol.id,
              protocol_code: protocolCode,
              priority,
              category,
              summary,
              condominium_name: condominiumName,
              condominium_id: condominiumId,
              requester_name: requesterName,
              requester_role: requesterRole,
              conversation_id: conversation_id,
              contact_id: contact?.id,
            }),
          }).then(res => res.json()).then(result => {
            console.log('Protocol-opened integrations result:', result);
          }).catch(err => {
            console.error('Protocol-opened integrations error:', err);
          });
        }
          
      } catch (protocolError) {
        console.error('Error creating protocol:', protocolError);
      }
    }

    // Send the AI response via WhatsApp with AI agent name
    const { error: sendError } = await supabase.functions.invoke('zapi-send-message', {
      body: {
        conversation_id: conversation_id,
        content: sanitizedResponse,
        message_type: 'text',
        sender_name: 'Ana Mônica', // AI assistant name for WhatsApp prefix
      },
    });

    if (sendError) {
      console.error('Failed to send AI message:', sendError);
      
      await supabase.from('ai_logs').insert({
        conversation_id,
        team_id: teamSettings?.team_id,
        provider: aiResponse.provider,
        model: aiResponse.model,
        request_id: aiResponse.request_id,
        input_excerpt: lastUserMessage?.content?.substring(0, 200),
        output_text: sanitizedResponse,
        tokens_in: aiResponse.tokens_in,
        tokens_out: aiResponse.tokens_out,
        latency_ms: aiResponse.latency_ms,
        status: 'error',
        error_message: sendError.message,
      });

      return new Response(
        JSON.stringify({ success: false, reason: 'send_failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update conversation state
    await supabase
      .from('ai_conversation_state')
      .update({
        auto_msg_count_window: (convState?.auto_msg_count_window || 0) + 1,
      })
      .eq('conversation_id', conversation_id);

    // Log success
    await supabase.from('ai_logs').insert({
      conversation_id,
      team_id: teamSettings?.team_id,
      provider: aiResponse.provider,
      model: aiResponse.model,
      request_id: aiResponse.request_id,
      input_excerpt: lastUserMessage?.content?.substring(0, 200),
      output_text: sanitizedResponse,
      tokens_in: aiResponse.tokens_in,
      tokens_out: aiResponse.tokens_out,
      latency_ms: aiResponse.latency_ms,
      status: 'success',
    });

    // Log AI usage for analytics
    await supabase.from('ai_usage_logs').insert({
      conversation_id,
      team_id: teamSettings?.team_id,
      provider: aiResponse.provider,
      model: aiResponse.model,
      mode: conversation.ai_mode || 'AUTO',
      input_tokens: aiResponse.tokens_in || 0,
      output_tokens: aiResponse.tokens_out || 0,
      latency_ms: aiResponse.latency_ms,
      estimated: !aiResponse.tokens_in && !aiResponse.tokens_out,
    });

    console.log('AI reply sent successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        response: sanitizedResponse,
        provider: aiResponse.provider,
        model: aiResponse.model,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('AI maybe reply error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
