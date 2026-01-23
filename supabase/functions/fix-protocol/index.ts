import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const protocolCode = '202601-0100-PG0'; // Suffix matches G7-202601-0100-PG0
        const fullProtocol = 'G7-202601-0100-PG0';

        console.log(`Fixing protocol: ${fullProtocol}`);

        // 1. Find the protocol
        const { data: protocol, error: findError } = await supabase
            .from('protocols')
            .select('*')
            .eq('protocol_code', protocolCode)
            .maybeSingle();

        if (findError) throw findError;
        if (!protocol) return new Response(JSON.stringify({ error: 'Protocol not found' }), { headers: corsHeaders });

        // 2. Update status and summary
        const updates = {
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            resolution_summary: 'Encerrado via script de correção (Agente não identificado/Áudio)',
            // If the summary was "Sem descrição", we might want to update it if we have the transcript
            // But for now, just closing it.
        };

        const { data: updated, error: updateError } = await supabase
            .from('protocols')
            .update(updates)
            .eq('id', protocol.id)
            .select()
            .single();

        if (updateError) throw updateError;

        // 3. Update related conversation if needed
        if (protocol.conversation_id) {
            await supabase.from('conversations')
                .update({ status: 'closed' })
                .eq('id', protocol.conversation_id);
        }

        return new Response(JSON.stringify({ success: true, protocol: updated }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
});
