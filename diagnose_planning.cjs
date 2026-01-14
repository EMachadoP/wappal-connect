
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('=== DIAGNÓSTICO: Condomínio no Planejamento ===\n');

    // 1) Contagem geral
    console.log('1) Contagem geral de protocolos:');
    const { data: allProtocols } = await supabase.from('protocols').select('condominium_id');
    if (allProtocols) {
        const missing = allProtocols.filter(p => !p.condominium_id).length;
        const with_condo = allProtocols.filter(p => p.condominium_id).length;
        console.log(`  Missing: ${missing}, With condo: ${with_condo}`);
    }

    console.log('\n2) Protocolo específico 202601-0097-1TA (protocols table):');
    const { data: p1 } = await supabase
        .from('protocols')
        .select('protocol_code, condominium_id, condominiums(name)')
        .eq('protocol_code', '202601-0097-1TA')
        .maybeSingle();

    if (p1) {
        console.log(JSON.stringify({
            protocol_code: p1.protocol_code,
            condominium_id: p1.condominium_id,
            condo_name: p1.condominiums?.name || null
        }, null, 2));
    } else {
        console.log('  Protocolo não encontrado!');
    }

    console.log('\n3) Mesmo protocolo na view v_planning_week:');
    const { data: v1, error: vErr } = await supabase
        .from('v_planning_week')
        .select('protocol_code, condominium_name')
        .eq('protocol_code', '202601-0097-1TA')
        .maybeSingle();

    if (vErr) {
        console.log(`  ERRO: ${vErr.message}`);
        console.log('  A view v_planning_week pode não existir ou ter problema!');
    } else if (v1) {
        console.log(JSON.stringify(v1, null, 2));
    } else {
        console.log('  Protocolo não encontrado na view (não está em plan_items)');
    }

    console.log('\n4) Sample da view (primeiros 3):');
    const { data: vSample } = await supabase
        .from('v_planning_week')
        .select('protocol_code, condominium_name, protocol_summary')
        .limit(3);

    if (vSample) {
        console.log(JSON.stringify(vSample, null, 2));
    }

    console.log('\n5) Conversas vs Protocolos (sample):');
    const { data: convCheck } = await supabase
        .from('protocols')
        .select('protocol_code, conversation_id, conversations(active_condominium_id, active_condominium_confidence)')
        .in('protocol_code', ['202601-0097-1TA', '202601-0096-G99', '202601-0093-KNB'])
        .limit(3);

    if (convCheck) {
        convCheck.forEach(p => {
            const conv = p.conversations;
            console.log(`${p.protocol_code}: active_condo=${conv?.active_condominium_id || 'NULL'}, conf=${conv?.active_condominium_confidence || 'NULL'}`);
        });
    }
}

run();
