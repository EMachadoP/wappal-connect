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

    // 1. Debounce Logic: Aguardar para agregar mensagens (4s + 2s verificação)
    const { data: initialLatest } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation_id)
      .eq('sender_type', 'contact')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const initialId = initialLatest?.id;
    console.log('[ai-maybe-reply] Debounce: Msg inicial:', initialId);

    // Espera 4 segundos
    await new Promise(r => setTimeout(r, 4000));

    // Check 1: Verificar se chegou nova mensagem
    const { data: check1 } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation_id)
      .eq('sender_type', 'contact')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (check1 && check1.id !== initialId) {
      console.log('[ai-maybe-reply] Debounce: Nova msg após 4s. Abortando.');
      return new Response(JSON.stringify({ success: false, reason: 'Debounced at 4s' }));
    }

    // Espera mais 2 segundos (total: 6s)
    await new Promise(r => setTimeout(r, 2000));

    // Check 2: Verificação final
    const { data: check2 } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation_id)
      .eq('sender_type', 'contact')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (check2 && check2.id !== initialId) {
      console.log('[ai-maybe-reply] Debounce: Nova msg após 6s. Abortando.');
      return new Response(JSON.stringify({ success: false, reason: 'Debounced at 6s' }));
    }

    console.log('[ai-maybe-reply] Debounce OK após 6s. Processando...');

    // 2. Carregar dados da conversa e configurações
    const { data: conv } = await supabase
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', conversation_id)
      .single();

    if (!conv || conv.ai_mode === 'OFF') {
      return new Response(JSON.stringify({ success: false, reason: 'IA OFF' }));
    }

    // 3. Checar papel do participante (Fornecedor)
    const { data: participantState } = await supabase
      .from('conversation_participant_state')
      .select('current_participant_id, participants(name, role_type, entity_id, entities(name))')
      .eq('conversation_id', conversation_id)
      .maybeSingle();

    if (participantState?.participants) {
      const participant = participantState.participants as any;
      if (participant.role_type === 'fornecedor') {
        console.log('[ai-maybe-reply] Bloqueando resposta automática para Fornecedor');
        return new Response(JSON.stringify({ success: false, reason: 'Role: fornecedor' }));
      }
    }

    // 4. Buscar histórico de mensagens
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

    // 5. Buscar prompt e configurações globais
    const { data: settings } = await supabase.from('ai_settings').select('*').maybeSingle();
    let systemPrompt = settings?.base_system_prompt || "Você é um assistente virtual.";
    let contextInfo = '';

    if (participantState?.participants) {
      const participant = participantState.participants as any;
      const roleLabels: Record<string, string> = {
        'sindico': 'Síndico',
        'subsindico': 'Subsíndico',
        'porteiro': 'Porteiro',
        'zelador': 'Zelador',
        'morador': 'Morador',
        'administrador': 'Administrador',
        'conselheiro': 'Conselheiro',
        'funcionario': 'Funcionário',
        'supervisor_condominial': 'Supervisor Condominial',
        'visitante': 'Visitante',
        'prestador': 'Prestador de Serviço',
        'fornecedor': 'Fornecedor',
        'outro': 'Outro'
      };

      const roleLabel = roleLabels[participant.role_type] || participant.role_type;
      const condoName = participant.entities?.name || 'não especificado';

      contextInfo += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      contextInfo += `\n📋 DADOS DO REMETENTE (JÁ IDENTIFICADOS)`;
      contextInfo += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      contextInfo += `\n👤 Nome: ${participant.name}`;
      if (participant.role_type) contextInfo += `\n💼 Função: ${roleLabel}`;
      if (participant.entities?.name) contextInfo += `\n🏢 Condomínio: ${condoName}`;
      contextInfo += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      contextInfo += `\n\n⚠️ INSTRUÇÕES CRÍTICAS:`;
      contextInfo += `\n1. NUNCA pergunte o nome do remetente - você JÁ SABE que é "${participant.name}"`;
      if (participant.role_type) contextInfo += `\n2. NUNCA pergunte a função - você JÁ SABE que é "${roleLabel}"`;
      if (participant.entities?.name) contextInfo += `\n3. NUNCA pergunte o condomínio - você JÁ SABE que é "${condoName}"`;
      contextInfo += `\n4. Use essas informações DIRETAMENTE ao criar protocolos`;
    }

    const now = new Date();
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: settings?.timezone || 'America/Recife',
      dateStyle: 'full',
      timeStyle: 'medium',
    });
    const currentTimeStr = formatter.format(now);

    const variables: Record<string, string> = {
      '{{customer_name}}': conv.contacts?.name || 'Cliente',
      '{{current_time}}': currentTimeStr,
    };

    for (const [key, value] of Object.entries(variables)) {
      systemPrompt = systemPrompt.replace(new RegExp(key, 'g'), value);
    }

    // Add message variation instructions
    systemPrompt += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    systemPrompt += `\n📝 REGRAS DE VARIAÇÃO DE MENSAGENS`;
    systemPrompt += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    systemPrompt += `\n\n⚠️ NUNCA REPITA A MESMA MENSAGEM!`;
    systemPrompt += `\n\n1. **Varie a estrutura das frases** - Use diferentes formas de expressar a mesma ideia`;
    systemPrompt += `\n2. **Use sinônimos** - Alterne palavras e expressões`;
    systemPrompt += `\n3. **Mude a ordem** - Reorganize as informações de forma diferente`;
    systemPrompt += `\n4. **Varie saudações** - Use diferentes formas de cumprimentar`;
    systemPrompt += `\n5. **Personalize** - Adapte o tom conforme o contexto`;
    systemPrompt += `\n\n✅ EXEMPLOS DE VARIAÇÃO:`;
    systemPrompt += `\n\nMensagem 1: "Olá! Registrei seu chamado sob o protocolo #123. Vamos resolver isso rapidamente!"`;
    systemPrompt += `\nMensagem 2: "Tudo certo! Criei o protocolo #124 para você. Nossa equipe já está ciente."`;
    systemPrompt += `\nMensagem 3: "Perfeito! Anotei tudo no protocolo #125. Em breve daremos retorno."`;
    systemPrompt += `\n\n❌ NUNCA faça:`;
    systemPrompt += `\n- Repetir exatamente a mesma estrutura de frase`;
    systemPrompt += `\n- Usar sempre as mesmas palavras de abertura`;
    systemPrompt += `\n- Copiar o formato da mensagem anterior`;
    systemPrompt += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    systemPrompt += contextInfo;

    // 5.5. Get participant_id for protocol creation
    const { data: participantData } = await supabase
      .from('conversation_participant_state')
      .select('participant_id, participants(name, role_type, entity_id)')
      .eq('conversation_id', conversation_id)
      .maybeSingle();

    const participant_id = participantData?.participant_id;
    console.log('[ai-maybe-reply] Participant ID:', participant_id);

    // 6. Gerar resposta
    console.log('[ai-maybe-reply] Chamando geração...');
    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/ai-generate-reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        messages,
        systemPrompt,
        conversation_id,
        participant_id,
      }),
    });

    const aiData = await aiResponse.json();
    if (!aiData.text) throw new Error('IA não gerou texto');

    // 6.5. DEDUPLICATION: Check if identical message was sent recently
    const { data: recentDuplicate } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation_id)
      .eq('sender_type', 'assistant')
      .eq('content', aiData.text)
      .gte('sent_at', new Date(Date.now() - 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();

    if (recentDuplicate) {
      console.log('[ai-maybe-reply] Dedupe: Identical message sent recently, skipping.');
      return new Response(JSON.stringify({ success: false, reason: 'Deduplicated' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 7. Enviar via Z-API
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

  } catch (error: any) {
    console.error('[ai-maybe-reply] Erro:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});