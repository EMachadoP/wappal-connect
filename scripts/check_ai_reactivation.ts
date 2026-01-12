import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkAIReactivation() {
    console.log('=== VERIFICAÇÃO DA REATIVAÇÃO AUTOMÁTICA DA IA ===\n');

    // 1. Eventos recentes de reativação da IA
    console.log('📋 1. EVENTOS RECENTES DE IA (últimos 20):');
    const { data: events, error: eventsError } = await supabase
        .from('ai_events')
        .select('id, conversation_id, event_type, message, created_at')
        .in('event_type', ['ai_auto_reactivated', 'ai_auto_resumed', 'ai_mode_changed'])
        .order('created_at', { ascending: false })
        .limit(20);

    if (eventsError) {
        console.error('Erro ao buscar eventos:', eventsError);
    } else if (!events || events.length === 0) {
        console.log('  ⚠️ Nenhum evento de reativação encontrado!\n');
    } else {
        events.forEach(e => {
            console.log(`  ${e.event_type} | ${new Date(e.created_at).toLocaleString('pt-BR')} | ${e.message?.substring(0, 50)}...`);
        });
        console.log('\n');
    }

    // 2. Conversas que DEVERIAM ter sido reativadas
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    console.log(`📋 2. CONVERSAS QUE DEVERIAM TER SIDO REATIVADAS (última msg > 30min):`);
    console.log(`   Threshold: ${new Date(thirtyMinutesAgo).toLocaleString('pt-BR')}\n`);

    const { data: pendingConvs, error: pendingError } = await supabase
        .from('conversations')
        .select(`
      id,
      ai_mode,
      human_control,
      ai_paused_until,
      last_message_at,
      status,
      contacts(name)
    `)
        .eq('status', 'open')
        .or('ai_mode.neq.AUTO,human_control.eq.true')
        .lt('last_message_at', thirtyMinutesAgo);

    if (pendingError) {
        console.error('Erro ao buscar conversas:', pendingError);
    } else if (!pendingConvs || pendingConvs.length === 0) {
        console.log('  ✅ Nenhuma conversa pendente de reativação!\n');
    } else {
        console.log(`  ⚠️ ${pendingConvs.length} conversa(s) pendente(s) de reativação:\n`);
        pendingConvs.forEach(c => {
            const minutesSinceMsg = Math.floor((Date.now() - new Date(c.last_message_at).getTime()) / 60000);
            const contactName = (c.contacts as any)?.name || 'Desconhecido';
            console.log(`  ID: ${c.id.substring(0, 8)}... | ${contactName}`);
            console.log(`     ai_mode: ${c.ai_mode} | human_control: ${c.human_control}`);
            console.log(`     Última msg: ${minutesSinceMsg} min atrás`);
            if (c.ai_paused_until) {
                console.log(`     ai_paused_until: ${new Date(c.ai_paused_until).toLocaleString('pt-BR')}`);
            }
            console.log('');
        });
    }

    // 3. Conversas com ai_paused_until expirado (deveria ter sido limpo)
    console.log('📋 3. CONVERSAS COM ai_paused_until EXPIRADO (deveria ter sido limpo):');
    const { data: expiredPauses } = await supabase
        .from('conversations')
        .select('id, ai_mode, human_control, ai_paused_until, status')
        .not('ai_paused_until', 'is', null)
        .lt('ai_paused_until', new Date().toISOString())
        .eq('status', 'open');

    if (!expiredPauses || expiredPauses.length === 0) {
        console.log('  ✅ Nenhum pause expirado pendente!\n');
    } else {
        console.log(`  ⚠️ ${expiredPauses.length} conversa(s) com pause expirado:\n`);
        expiredPauses.forEach(c => {
            console.log(`  ID: ${c.id.substring(0, 8)}... | ai_mode: ${c.ai_mode} | paused_until: ${c.ai_paused_until}`);
        });
        console.log('');
    }

    // 4. Resumo geral de conversas
    console.log('📋 4. RESUMO GERAL DE CONVERSAS ABERTAS:');
    const { data: allOpen } = await supabase
        .from('conversations')
        .select('ai_mode, human_control')
        .eq('status', 'open');

    if (allOpen) {
        const auto = allOpen.filter(c => c.ai_mode === 'AUTO' && !c.human_control).length;
        const copilot = allOpen.filter(c => c.ai_mode === 'COPILOT').length;
        const off = allOpen.filter(c => c.ai_mode === 'OFF').length;
        const humanActive = allOpen.filter(c => c.human_control).length;

        console.log(`  Total abertas: ${allOpen.length}`);
        console.log(`  IA AUTO: ${auto}`);
        console.log(`  IA COPILOT: ${copilot}`);
        console.log(`  IA OFF: ${off}`);
        console.log(`  Humano ativo: ${humanActive}`);
    }

    console.log('\n=== FIM DA VERIFICAÇÃO ===');
}

checkAIReactivation().catch(console.error);
