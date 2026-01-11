import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Inactivity threshold in minutes
const INACTIVITY_THRESHOLD_MINUTES = 30;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Running AI auto-reactivate check...');

    // Calculate threshold time (30 minutes ago)
    const thresholdTime = new Date();
    thresholdTime.setMinutes(thresholdTime.getMinutes() - INACTIVITY_THRESHOLD_MINUTES);
    const thresholdIso = thresholdTime.toISOString();

    // Find open conversations where:
    // - AI is not in AUTO mode OR human_control is true
    // - Last message was more than 30 minutes ago
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        ai_mode,
        human_control,
        last_message_at,
        contact_id,
        contacts(name)
      `)
      .eq('status', 'open')
      .or('ai_mode.neq.AUTO,human_control.eq.true')
      .lt('last_message_at', thresholdIso);

    if (convError) {
      console.error('Error fetching conversations:', convError);
      throw convError;
    }

    if (!conversations || conversations.length === 0) {
      console.log('No conversations need AI reactivation');
      return new Response(JSON.stringify({
        success: true,
        reactivated: 0,
        message: 'No conversations to reactivate',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${conversations.length} conversations to reactivate`);

    const reactivatedIds: string[] = [];
    const errors: string[] = [];

    for (const conv of conversations) {
      try {
        // Check if participant is a supplier (fornecedor) - skip AI reactivation for them
        const { data: participantState } = await supabase
          .from('conversation_participant_state')
          .select('current_participant_id, participants(role_type)')
          .eq('conversation_id', conv.id)
          .maybeSingle();

        // deno-lint-ignore no-explicit-any
        const participant = participantState?.participants as any;
        if (participant?.role_type === 'fornecedor') {
          // deno-lint-ignore no-explicit-any
          const contactName = (conv.contacts as any)?.name || 'Desconhecido';
          console.log(`Skipping AI reactivation for supplier: ${conv.id} (${contactName})`);
          continue; // Don't reactivate AI for suppliers
        }

        // Update conversation to reactivate AI
        const { error: updateError } = await supabase
          .from('conversations')
          .update({
            ai_mode: 'AUTO',
            human_control: false,
            ai_paused_until: null,
          })
          .eq('id', conv.id);

        if (updateError) {
          console.error(`Error updating conversation ${conv.id}:`, updateError);
          errors.push(`${conv.id}: ${updateError.message}`);
          continue;
        }

        // Log the reactivation event
        await supabase.from('ai_events').insert({
          conversation_id: conv.id,
          event_type: 'ai_auto_reactivated',
          message: `🤖 IA reativada automaticamente após ${INACTIVITY_THRESHOLD_MINUTES} minutos de inatividade.`,
          metadata: {
            reason: 'inactivity_timeout',
            previous_mode: conv.ai_mode,
            previous_human_control: conv.human_control,
            last_message_at: conv.last_message_at,
          },
        });

        // deno-lint-ignore no-explicit-any
        const contactName = (conv.contacts as any)?.name || 'Desconhecido';
        console.log(`Reactivated AI for conversation ${conv.id} (${contactName})`);
        reactivatedIds.push(conv.id);

      } catch (err) {
        console.error(`Error processing conversation ${conv.id}:`, err);
        errors.push(`${conv.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    console.log(`AI reactivation complete: ${reactivatedIds.length} reactivated, ${errors.length} errors`);

    return new Response(JSON.stringify({
      success: true,
      reactivated: reactivatedIds.length,
      reactivated_ids: reactivatedIds,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('AI auto-reactivate error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
