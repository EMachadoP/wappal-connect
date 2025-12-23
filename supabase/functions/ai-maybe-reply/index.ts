import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

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

    // Get conversation history
    const { data: messages } = await supabase
      .from('messages')
      .select('content, sender_type, sent_at')
      .eq('conversation_id', conversation_id)
      .order('sent_at', { ascending: false })
      .limit(settings.memory_message_count);

    const conversationHistory = (messages || [])
      .reverse()
      .filter(m => m.content)
      .map(m => ({
        role: m.sender_type === 'contact' ? 'user' : 'assistant',
        content: m.content!,
      }));

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
    
    const contact = conversation.contacts;
    
    // Fetch participant info for context
    let participantContext = '';
    let shouldUsePersonalName = true;
    
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

      // Build context header
      participantContext = `
--- CONTEXTO DO CONTATO ---
Telefone: ${contact.phone || 'N/A'}
Nome WhatsApp: ${contact.whatsapp_display_name || 'N/A'} (${displayNameType === 'ENTITY_NAME' ? 'Nome de entidade - NÃO usar como nome pessoal' : 'Possível nome pessoal'})
Tags: ${(contact.tags || []).join(', ') || 'Nenhuma'}
`;

      if (participantData) {
        const entity = participantData.entities as { id: string; name: string; type: string } | null;
        participantContext += `
--- IDENTIDADE CONFIRMADA ---
Nome: ${participantData.name}
Função: ${participantData.role_type || 'N/A'}
Entidade: ${entity?.name || 'N/A'}
Confiança: ${Math.round(participantData.confidence * 100)}%
`;
        // Use personal name only if confidence is high enough
        shouldUsePersonalName = participantData.confidence >= 0.7;
      } else {
        participantContext += `
--- IDENTIDADE NÃO CONFIRMADA ---
O remetente ainda não foi identificado. NÃO use nomes pessoais até que a identidade seja confirmada.
`;
        shouldUsePersonalName = false;
      }

      // Check if we need to ask for identification
      if (!participantData && (!convParticipantState || !convParticipantState.identification_asked)) {
        participantContext += `
INSTRUÇÃO: Na próxima resposta, pergunte educadamente: "Por gentileza, poderia me informar seu nome, de qual condomínio/empresa fala e qual sua função?"
Após perguntar, isso será registrado e não precisará perguntar novamente.
`;
        // Mark that we asked
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

    // Send the AI response via WhatsApp
    const { error: sendError } = await supabase.functions.invoke('zapi-send-message', {
      body: {
        conversation_id: conversation_id,
        content: aiResponse.text,
        message_type: 'text',
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
        output_text: aiResponse.text,
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
      output_text: aiResponse.text,
      tokens_in: aiResponse.tokens_in,
      tokens_out: aiResponse.tokens_out,
      latency_ms: aiResponse.latency_ms,
      status: 'success',
    });

    console.log('AI reply sent successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        response: aiResponse.text,
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
