import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  try {
    // 1. Validar Sessão (Garante que quem chama é um usuário logado no App)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado: Header ausente');

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Sessão inválida ou expirada');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { conversation_id, condominium_id, category, priority, summary, notify_group, participant_id, contact_id } = body;

    // 2. Verificar se já existe protocolo aberto (Idempotência)
    const { data: existing } = await supabaseAdmin
      .from('protocols')
      .select('id, protocol_code')
      .eq('conversation_id', conversation_id)
      .eq('status', 'open')
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ 
        success: true, 
        protocol: existing, 
        already_existed: true 
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // 3. Gerar código sequencial via RPC
    const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
    const { data: protocolCode, error: rpcError } = await supabaseAdmin.rpc('generate_protocol_code', { 
      p_year_month: yearMonth 
    });

    if (rpcError) throw rpcError;

    // 4. Inserir protocolo forçando o ID do agente autenticado
    const { data: protocol, error: insError } = await supabaseAdmin
      .from('protocols')
      .insert({
        protocol_code: protocolCode,
        conversation_id,
        condominium_id,
        contact_id,
        participant_id,
        category: category || 'Geral',
        priority: priority || 'normal',
        summary,
        status: 'open',
        created_by_type: 'agent',
        created_by_agent_id: user.id // Identidade garantida pela sessão
      })
      .select()
      .single();

    if (insError) throw insError;

    // 5. Atualizar registro na conversa
    await supabaseAdmin
      .from('conversations')
      .update({ protocol: protocolCode })
      .eq('id', conversation_id);

    // 6. Disparar notificações assíncronas (Asana/WhatsApp)
    if (notify_group) {
      fetch(`${supabaseUrl}/functions/v1/protocol-opened`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${supabaseServiceKey}` 
        },
        body: JSON.stringify({ protocol_id: protocol.id, ...body }),
      }).catch(err => console.error('Notification trigger error:', err));
    }

    return new Response(JSON.stringify({ success: true, protocol }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('Create protocol error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});