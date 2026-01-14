
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('=== DEBUGGING: Why Aijolan has no assignments ===\n');

    // 1. Check Aijolan's details
    const { data: aijolan } = await supabase
        .from('technicians')
        .select('id, name, is_active, dispatch_priority, is_wildcard')
        .ilike('name', '%Aijolan%')
        .single();

    console.log('1) Aijolan Details:');
    console.log(JSON.stringify(aijolan, null, 2));

    if (!aijolan) {
        console.log('ERROR: Aijolan not found!');
        return;
    }

    // 2. Check his skills via join
    const { data: aijolanSkills } = await supabase
        .from('technician_skills')
        .select('skills(code)')
        .eq('technician_id', aijolan.id);

    const skillCodes = (aijolanSkills || []).map(ts => ts.skills?.code).filter(Boolean);
    console.log('\n2) Aijolan Skills:', skillCodes);

    // 3. Check what work items require
    const { data: workItems } = await supabase
        .from('protocol_work_items')
        .select('id, title, required_skill_codes, status')
        .in('status', ['open', 'planned'])
        .limit(3);

    console.log('\n3) Sample Work Items:');
    workItems?.forEach(wi => {
        console.log(`  - ${wi.title}: requires [${wi.required_skill_codes?.join(', ')}]`);
        const hasAll = wi.required_skill_codes?.every(s => skillCodes.includes(s));
        console.log(`    Aijolan matches: ${hasAll ? 'YES ✓' : 'NO ✗'}`);
    });

    // 4. Check current plan_items
    const { data: planItems } = await supabase
        .from('plan_items')
        .select('technician_id, technicians(name)')
        .gte('plan_date', '2026-01-19');

    const techCounts = {};
    planItems?.forEach(pi => {
        const name = pi.technicians?.name || 'Unknown';
        techCounts[name] = (techCounts[name] || 0) + 1;
    });

    console.log('\n4) Current Assignments:');
    Object.entries(techCounts).forEach(([name, count]) => {
        console.log(`  ${name}: ${count} items`);
    });

    // 5. Check dispatch_priority comparison
    const { data: allTechs } = await supabase
        .from('technicians')
        .select('name, dispatch_priority, is_wildcard, is_active')
        .eq('is_active', true)
        .order('dispatch_priority');

    console.log('\n5) All Active Technicians (by priority):');
    allTechs?.forEach(t => {
        console.log(`  ${t.name}: priority=${t.dispatch_priority || 100}, wildcard=${t.is_wildcard || false}`);
    });
}

run();
