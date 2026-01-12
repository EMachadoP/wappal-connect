import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkCronStatus() {
    console.log('=== VERIFICAÇÃO DO PG_CRON ===\n');

    // 1. Verificar se a extensão pg_cron está habilitada
    console.log('📋 1. EXTENSÕES INSTALADAS:');
    const { data: extensions, error: extError } = await supabase.rpc('get_extensions');

    if (extError) {
        console.log('  Erro ao buscar extensões via RPC, tentando via SQL direto...');
        // Tentar via query direta
        const { data: extData, error: extErr2 } = await supabase
            .from('pg_extension')
            .select('*');

        if (extErr2) {
            console.log('  ⚠️ Não foi possível verificar extensões:', extErr2.message);
        } else {
            console.log('  Extensões:', extData);
        }
    } else {
        const pgCron = extensions?.find((e: any) => e.name === 'pg_cron');
        if (pgCron) {
            console.log('  ✅ pg_cron está instalado!');
        } else {
            console.log('  ❌ pg_cron NÃO está instalado');
            console.log('  Extensões encontradas:', extensions?.map((e: any) => e.name).join(', '));
        }
    }

    // 2. Verificar jobs agendados
    console.log('\n📋 2. JOBS AGENDADOS NO CRON:');
    const { data: jobs, error: jobsError } = await supabase.rpc('list_cron_jobs');

    if (jobsError) {
        console.log('  ⚠️ Não foi possível listar jobs via RPC:', jobsError.message);
        console.log('  Isso geralmente significa que pg_cron não está habilitado.');
    } else if (!jobs || jobs.length === 0) {
        console.log('  ⚠️ Nenhum job encontrado!');
    } else {
        console.log('  Jobs encontrados:');
        jobs.forEach((job: any) => {
            console.log(`    - ${job.jobname}: ${job.schedule} | ${job.command?.substring(0, 50)}...`);
        });
    }

    // 3. Tentar executar a função de reativação manualmente
    console.log('\n📋 3. TESTANDO A FUNÇÃO resume_expired_ai_pauses():');
    const { data: result, error: fnError } = await supabase.rpc('resume_expired_ai_pauses');

    if (fnError) {
        console.log('  ❌ Erro ao executar função:', fnError.message);
    } else {
        console.log('  ✅ Função executada com sucesso!');
        console.log('  Conversas reativadas:', result);
    }

    // 4. Verificar se há conversas que precisam ser reativadas
    console.log('\n📋 4. CONVERSAS PENDENTES APÓS A EXECUÇÃO:');
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: pending } = await supabase
        .from('conversations')
        .select('id, ai_mode, human_control, ai_paused_until, last_message_at')
        .eq('status', 'open')
        .or('ai_mode.neq.AUTO,human_control.eq.true')
        .lt('last_message_at', thirtyMinutesAgo);

    if (!pending || pending.length === 0) {
        console.log('  ✅ Nenhuma conversa pendente!');
    } else {
        console.log(`  ⚠️ Ainda há ${pending.length} conversas pendentes`);
        pending.slice(0, 3).forEach(c => {
            const mins = Math.floor((Date.now() - new Date(c.last_message_at).getTime()) / 60000);
            console.log(`    - ${c.id.substring(0, 8)}... | mode: ${c.ai_mode} | human: ${c.human_control} | ${mins}min`);
        });
    }

    console.log('\n=== FIM ===');
}

checkCronStatus().catch(console.error);
