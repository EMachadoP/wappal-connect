import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const {
      conversation_id,
      condominium_id,
      category,
      priority,
      summary,
      notify_group,
      participant_id,
      requester_name,
      requester_role,
      contact_id,
      created_by_agent_id,
      idempotency_key, // Optional: client-provided key to prevent duplicates
    } = body;

    console.log('create-protocol called with:', JSON.stringify(body, null, 2));

    // Validate required fields
    if (!conversation_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'conversation_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for existing protocol on this conversation (idempotency)
    const { data: existingProtocol, error: checkError } = await supabase
      .from('protocols')
      .select('id, protocol_code, status')
      .eq('conversation_id', conversation_id)
      .eq('status', 'open')
      .maybeSingle();

    if (checkError) {
      console.error('Error checking existing protocol:', checkError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to check existing protocol' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If there's already an open protocol for this conversation, return it
    if (existingProtocol) {
      console.log('Existing open protocol found:', existingProtocol.protocol_code);
      return new Response(
        JSON.stringify({
          success: true,
          protocol: existingProtocol,
          already_existed: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate protocol code with atomic counter using advisory lock
    const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
    
    // Use a transaction with advisory lock to prevent race conditions
    const { data: protocolData, error: protocolError } = await supabase.rpc('generate_protocol_code', {
      p_year_month: yearMonth,
    });

    if (protocolError) {
      console.error('Error generating protocol code via RPC:', protocolError);
      
      // Fallback: generate code with SELECT FOR UPDATE pattern
      const { data: maxProtocol, error: maxError } = await supabase
        .from('protocols')
        .select('protocol_code')
        .like('protocol_code', `${yearMonth}-%`)
        .order('protocol_code', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (maxError) {
        console.error('Error fetching max protocol:', maxError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to generate protocol code' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let sequence = 1;
      if (maxProtocol?.protocol_code) {
        const parts = maxProtocol.protocol_code.split('-');
        if (parts.length === 2) {
          sequence = parseInt(parts[1], 10) + 1;
        }
      }
      
      const protocolCode = `${yearMonth}-${String(sequence).padStart(4, '0')}`;
      
      // Insert protocol with unique constraint protection
      const { data: insertedProtocol, error: insertError } = await supabase
        .from('protocols')
        .insert({
          protocol_code: protocolCode,
          conversation_id,
          condominium_id: condominium_id || null,
          contact_id: contact_id || null,
          participant_id: participant_id || null,
          requester_name: requester_name || null,
          requester_role: requester_role || null,
          category: category || 'Geral',
          priority: priority || 'medium',
          summary: summary || null,
          status: 'open',
          created_by_type: 'agent',
          created_by_agent_id: created_by_agent_id || null,
        })
        .select()
        .single();

      if (insertError) {
        // Check if it's a unique constraint violation (race condition)
        if (insertError.code === '23505') {
          console.log('Race condition detected, retrying...');
          // Retry once with incremented sequence
          const retryCode = `${yearMonth}-${String(sequence + 1).padStart(4, '0')}`;
          const { data: retryProtocol, error: retryError } = await supabase
            .from('protocols')
            .insert({
              protocol_code: retryCode,
              conversation_id,
              condominium_id: condominium_id || null,
              contact_id: contact_id || null,
              participant_id: participant_id || null,
              requester_name: requester_name || null,
              requester_role: requester_role || null,
              category: category || 'Geral',
              priority: priority || 'medium',
              summary: summary || null,
              status: 'open',
              created_by_type: 'agent',
              created_by_agent_id: created_by_agent_id || null,
            })
            .select()
            .single();

          if (retryError) {
            console.error('Retry insert failed:', retryError);
            return new Response(
              JSON.stringify({ success: false, error: 'Failed to create protocol after retry' }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Update conversation with protocol code
          await supabase
            .from('conversations')
            .update({
              protocol: retryProtocol.protocol_code,
              priority: priority || 'medium',
              active_condominium_id: condominium_id || null,
            })
            .eq('id', conversation_id);

          console.log('Protocol created after retry:', retryProtocol.protocol_code);
          return new Response(
            JSON.stringify({ success: true, protocol: retryProtocol, already_existed: false }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.error('Insert error:', insertError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create protocol' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update conversation with protocol code
      await supabase
        .from('conversations')
        .update({
          protocol: insertedProtocol.protocol_code,
          priority: priority || 'medium',
          active_condominium_id: condominium_id || null,
        })
        .eq('id', conversation_id);

      console.log('Protocol created successfully:', insertedProtocol.protocol_code);

      // Trigger notification if requested
      if (notify_group) {
        try {
          // Fetch condominium name if we have an ID
          let condominiumName: string | null = null;
          if (condominium_id) {
            const { data: condo } = await supabase
              .from('condominiums')
              .select('name')
              .eq('id', condominium_id)
              .single();
            condominiumName = condo?.name || null;
          }
          
          await supabase.functions.invoke('protocol-opened', {
            body: {
              protocol_id: insertedProtocol.id,
              protocol_code: insertedProtocol.protocol_code,
              conversation_id,
              condominium_id,
              condominium_name: condominiumName,
              category,
              priority,
              summary,
              requester_name,
              requester_role,
            },
          });
          console.log('protocol-opened notification triggered');
        } catch (notifyError) {
          console.error('Failed to trigger protocol-opened notification:', notifyError);
          // Don't fail the whole request for notification errors
        }
      }

      return new Response(
        JSON.stringify({ success: true, protocol: insertedProtocol, already_existed: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // RPC succeeded - use the generated code
    const protocolCode = protocolData;
    console.log('Protocol code generated via RPC:', protocolCode);

    const { data: insertedProtocol, error: insertError } = await supabase
      .from('protocols')
      .insert({
        protocol_code: protocolCode,
        conversation_id,
        condominium_id: condominium_id || null,
        contact_id: contact_id || null,
        participant_id: participant_id || null,
        requester_name: requester_name || null,
        requester_role: requester_role || null,
        category: category || 'Geral',
        priority: priority || 'medium',
        summary: summary || null,
        status: 'open',
        created_by_type: 'agent',
        created_by_agent_id: created_by_agent_id || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error after RPC:', insertError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create protocol' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update conversation
    await supabase
      .from('conversations')
      .update({
        protocol: insertedProtocol.protocol_code,
        priority: priority || 'medium',
        active_condominium_id: condominium_id || null,
      })
      .eq('id', conversation_id);

    // Trigger notification if requested
    if (notify_group) {
      try {
        // Fetch condominium name if we have an ID
        let condominiumName: string | null = null;
        if (condominium_id) {
          const { data: condo } = await supabase
            .from('condominiums')
            .select('name')
            .eq('id', condominium_id)
            .single();
          condominiumName = condo?.name || null;
        }
        
        await supabase.functions.invoke('protocol-opened', {
          body: {
            protocol_id: insertedProtocol.id,
            protocol_code: insertedProtocol.protocol_code,
            conversation_id,
            condominium_id,
            condominium_name: condominiumName,
            category,
            priority,
            summary,
            requester_name,
            requester_role,
          },
        });
      } catch (notifyError) {
        console.error('Failed to trigger notification:', notifyError);
      }
    }

    console.log('Protocol created successfully:', insertedProtocol.protocol_code);
    return new Response(
      JSON.stringify({ success: true, protocol: insertedProtocol, already_existed: false }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Unexpected error in create-protocol:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
