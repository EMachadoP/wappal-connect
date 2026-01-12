import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkProtocolSetup() {
    console.log('=== VERIFICAÇÃO DO SISTEMA DE PROTOCOLO ===\n');

    // 1. Check if protocol_sequences table exists
    console.log('📋 1. TABELA protocol_sequences:');
    const { data: seqTable, error: seqErr } = await supabase
        .from('protocol_sequences')
        .select('*')
        .limit(5);

    if (seqErr) {
        console.log(`  ❌ Erro ao acessar tabela: ${seqErr.message}`);
        console.log(`  Código: ${seqErr.code}`);
    } else {
        console.log('  ✅ Tabela existe!');
        console.log('  Registros:', seqTable);
    }

    // 2. Check if get_next_protocol_sequence function exists
    console.log('\n📋 2. FUNÇÃO get_next_protocol_sequence:');
    try {
        const yearMonth = '202601'; // Current year-month
        const { data: seqData, error: rpcErr } = await supabase
            .rpc('get_next_protocol_sequence', { year_month_param: yearMonth });

        if (rpcErr) {
            console.log(`  ❌ Erro na função RPC: ${rpcErr.message}`);
            console.log(`  Detalhes: ${JSON.stringify(rpcErr)}`);
        } else {
            console.log('  ✅ Função existe e funcionou!');
            console.log(`  Próxima sequência para ${yearMonth}: ${seqData}`);
        }
    } catch (e: any) {
        console.log(`  ❌ Exceção: ${e.message}`);
    }

    // 3. Check protocols table structure
    console.log('\n📋 3. ÚLTIMOS PROTOCOLOS:');
    const { data: protocols, error: protoErr } = await supabase
        .from('protocols')
        .select('id, protocol_code, status, category, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    if (protoErr) {
        console.log(`  ❌ Erro ao acessar protocols: ${protoErr.message}`);
    } else {
        console.log('  ✅ Tabela protocols OK');
        protocols?.forEach(p => {
            console.log(`    - ${p.protocol_code} | ${p.status} | ${p.category} | ${p.created_at}`);
        });
    }

    // 4. Check if RLS is enabled on protocol_sequences
    console.log('\n📋 4. RLS CHECK (protocol_sequences):');
    // Try to select without auth - if RLS is off, this will work
    const anonClient = createClient(SUPABASE_URL, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU2OTk2MzAsImV4cCI6MjA1MTI3NTYzMH0.YfKYmJV93CddGSvHFdH2lI6hl_OZ7hN_RpnKb9LQ1vU');
    const { error: anonErr } = await anonClient
        .from('protocol_sequences')
        .select('*')
        .limit(1);

    if (anonErr) {
        console.log('  ✅ RLS está ativado (anon não consegue acessar)');
    } else {
        console.log('  ⚠️ RLS DESATIVADO - tabela acessível publicamente!');
    }

    console.log('\n=== FIM ===');
}

checkProtocolSetup().catch(console.error);
