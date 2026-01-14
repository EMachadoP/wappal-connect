
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('=== INVESTIGAÇÃO: Issues do Planejamento ===\n');

    // 1) Aijolan existe?
    console.log('1) Verificando Aijolan...');
    const { data: aijolan } = await supabase
        .from('technicians')
        .select('id, name, is_active')
        .ilike('name', '%Aijolan%')
        .maybeSingle();

    if (aijolan) {
        console.log(`   ✅ Existe: ${aijolan.name}, active=${aijolan.is_active}`);

        // Tem plan_items?
        const { data: aijolanItems } = await supabase
            .from('plan_items')
            .select('*')
            .eq('technician_id', aijolan.id);
        console.log(`   Plan items: ${aijolanItems?.length || 0}`);
    } else {
        console.log('   ❌ Aijolan NÃO EXISTE no banco!');
    }

    // 2) Horários da tarde
    console.log('\n2) Verificando slots de horário...');
    const { data: allItems } = await supabase
        .from('plan_items')
        .select('start_minute, end_minute, plan_date')
        .order('start_minute');

    if (allItems) {
        const morning = allItems.filter(i => i.start_minute < 720); // antes 12:00
        const afternoon = allItems.filter(i => i.start_minute >= 720); // depois 12:00
        console.log(`   Manhã (< 12:00): ${morning.length}`);
        console.log(`   Tarde (>= 12:00): ${afternoon.length}`);
    }

    // 3) Categorias dos work items
    console.log('\n3) Categorias de work items...');
    const { data: workItems } = await supabase
        .from('protocol_work_items')
        .select('category, status')
        .in('status', ['open', 'planned']);

    if (workItems) {
        const categories = {};
        workItems.forEach(wi => {
            categories[wi.category] = (categories[wi.category] || 0) + 1;
        });
        Object.entries(categories).forEach(([cat, count]) => {
            console.log(`   ${cat}: ${count}`);
        });
    }

    // 4) Material requests
    console.log('\n4) Verificando material_requests...');
    const { data: materials } = await supabase
        .from('material_requests')
        .select('*')
        .limit(5);

    console.log(`   Total: ${materials?.length || 0}`);

    // 5) Resumos longos
    console.log('\n5) Protocolos com resumos longos...');
    const { data: protocols } = await supabase
        .from('protocols')
        .select('protocol_code, summary')
        .limit(10);

    if (protocols) {
        protocols.forEach(p => {
            const len = p.summary?.length || 0;
            if (len > 50) {
                console.log(`   ${p.protocol_code}: ${len} chars`);
            }
        });
    }
}

run();
