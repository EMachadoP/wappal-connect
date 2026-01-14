
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('=== DIAGNÓSTICO COMPLETO DO SEED ===\n');

    // 1) Condominiums
    const { data: condos } = await supabase
        .from('condominiums')
        .select('id, name')
        .in('id', ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']);
    console.log('1) Condominiums:', condos?.length || 0);

    // 2) Contacts
    const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name')
        .eq('id', '33333333-3333-3333-3333-333333333333');
    console.log('2) Contacts:', contacts?.length || 0);

    // 3) Conversations
    const { data: convs } = await supabase
        .from('conversations')
        .select('id, thread_key')
        .in('id', ['44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555']);
    console.log('3) Conversations:', convs?.length || 0);

    // 4) Protocols
    const { data: protocols } = await supabase
        .from('protocols')
        .select('id, protocol_code')
        .in('protocol_code', ['TEST-0001-AAA', 'TEST-0002-BBB']);
    console.log('4) Protocols:', protocols?.length || 0);

    // 5) Work Items
    const { data: workItems } = await supabase
        .from('protocol_work_items')
        .select('id, title')
        .in('id', ['88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999']);
    console.log('5) Work Items:', workItems?.length || 0);

    // 6) Technicians
    const { data: techs } = await supabase
        .from('technicians')
        .select('id, name')
        .in('id', ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
    console.log('6) Technicians:', techs?.length || 0);
    if (techs) {
        techs.forEach(t => console.log(`   - ${t.name}`));
    }

    // 7) Plan Items
    const { data: planItems, error: piErr } = await supabase
        .from('plan_items')
        .select('*')
        .in('id', ['cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd']);
    console.log('\n7) Plan Items:', planItems?.length || 0);
    if (piErr) {
        console.log('   ERROR:', piErr.message);
    } else if (planItems && planItems.length > 0) {
        planItems.forEach(pi => {
            console.log(`   - ${pi.plan_date} @ ${pi.start_minute}min, tech=${pi.technician_id}, work=${pi.work_item_id}`);
        });
    } else {
        console.log('   ❌ Nenhum plan_item foi criado!');
    }

    // 8) Ver se há ALGUM plan_item no banco
    const { data: allPlanItems } = await supabase
        .from('plan_items')
        .select('id, plan_date, technician_id')
        .limit(5);
    console.log('\n8) Total de plan_items no banco:', allPlanItems?.length || 0);

    // 9) Tentar ver na view
    console.log('\n9) Verificando v_planning_week:');
    const { data: viewData, error: viewErr } = await supabase
        .from('v_planning_week')
        .select('protocol_code, condominium_name, technician_name, plan_date')
        .limit(5);

    if (viewErr) {
        console.log('   ERROR:', viewErr.message);
    } else if (viewData && viewData.length > 0) {
        console.log(`   ✅ View retorna ${viewData.length} registros:`);
        viewData.forEach(v => {
            console.log(`   - ${v.protocol_code} @ ${v.plan_date} -> ${v.technician_name} (${v.condominium_name})`);
        });
    } else {
        console.log('   ❌ View não retorna dados (plan_items está vazio)');
    }
}

run();
