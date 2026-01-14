
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('=== Por que Aijolan não é alocado? ===\n');

    // 1) Skills de Aijolan
    const { data: aijolan } = await supabase
        .from('technicians')
        .select('id, name, dispatch_priority, is_wildcard, technician_skills(skills(code))')
        .ilike('name', '%Aijolan%')
        .maybeSingle();

    if (!aijolan) {
        console.log('❌ Aijolan não existe!');
        return;
    }

    const aijolanSkills = (aijolan.technician_skills || []).map(ts => ts.skills?.code).filter(Boolean);
    console.log('1) Aijolan:');
    console.log(`   Skills: ${aijolanSkills.join(', ')}`);
    console.log(`   dispatch_priority: ${aijolan.dispatch_priority || 100}`);
    console.log(`   is_wildcard: ${aijolan.is_wildcard || false}`);

    // 2) Work items requer skills
    const { data: workItems } = await supabase
        .from('protocol_work_items')
        .select('id, title, required_skill_codes, status')
        .in('status', ['open', 'planned'])
        .limit(10);

    console.log('\n2) Work items (open/planned):');
    workItems?.forEach(wi => {
        const required = wi.required_skill_codes || [];
        const hasAll = required.every(s => aijolanSkills.includes(s));
        console.log(`   ${wi.title}`);
        console.log(`     Required: [${required.join(', ')}]`);
        console.log(`     Aijolan matches: ${hasAll ? '✓ YES' : '✗ NO'} ${!hasAll ? '(missing: ' + required.filter(s => !aijolanSkills.includes(s)).join(', ') + ')' : ''}`);
    });

    // 3) Outros técnicos com plan_items
    const { data: techsWithItems } = await supabase
        .from('plan_items')
        .select('technician_id, technicians(name, dispatch_priority, is_wildcard)')
        .limit(5);

    console.log('\n3) Técnicos com agendamentos:');
    const techMap = new Map();
    techsWithItems?.forEach(pi => {
        const tech = pi.technicians;
        if (tech && !techMap.has(tech.name)) {
            techMap.set(tech.name, {
                priority: tech.dispatch_priority || 100,
                wildcard: tech.is_wildcard || false
            });
        }
    });

    techMap.forEach((data, name) => {
        console.log(`   ${name}: priority=${data.priority}, wildcard=${data.wildcard}`);
    });

    console.log(`\n   Aijolan (comparison): priority=${aijolan.dispatch_priority || 100}, wildcard=${aijolan.is_wildcard || false}`);
}

run();
