
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('=== 1) Checking Aijolan ===');
    const { data: aijolan } = await supabase
        .from('technicians')
        .select('id, name, is_active, dispatch_priority, technician_skills(skills(code))')
        .ilike('name', '%Aijolan%')
        .single();

    if (aijolan) {
        console.log('Aijolan:', JSON.stringify(aijolan, null, 2));
    } else {
        console.log('Aijolan not found!');
    }

    console.log('\n=== 2) Checking all active technicians ===');
    const { data: techs } = await supabase
        .from('technicians')
        .select('id, name, is_active, technician_skills(skills(code))')
        .eq('is_active', true)
        .order('name');

    if (techs) {
        techs.forEach(t => {
            const skills = (t.technician_skills || []).map(ts => ts.skills?.code).filter(Boolean);
            console.log(`${t.name}: ${skills.join(', ') || 'NO SKILLS'}`);
        });
    }

    console.log('\n=== 3) Checking protocol_work_items (recent 5) ===');
    const { data: workItems } = await supabase
        .from('protocol_work_items')
        .select('id, title, required_skill_codes, status')
        .in('status', ['open', 'planned'])
        .order('created_at', { ascending: false })
        .limit(5);

    console.log('Recent work items:', JSON.stringify(workItems, null, 2));

    console.log('\n=== 4) Checking protocols & condominiums ===');
    const { data: protocols } = await supabase
        .from('protocols')
        .select('id, protocol_code, condominium_id, summary, condominiums(name)')
        .order('created_at', { ascending: false })
        .limit(5);

    console.log('Recent protocols:', JSON.stringify(protocols, null, 2));

    console.log('\n=== 5) Checking v_planning_week sample ===');
    const { data: planningView } = await supabase
        .from('v_planning_week')
        .select('*')
        .limit(3);

    if (planningView && planningView.length > 0) {
        console.log('Planning view sample:', JSON.stringify(planningView[0], null, 2));
    } else {
        console.log('No data in v_planning_week');
    }
}

run();
