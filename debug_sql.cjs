
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- Query 1: plan_items count by date ---');
    const { data: d1, error: e1 } = await supabase
        .from('plan_items')
        .select('plan_date')
        .gte('plan_date', '2026-01-19')
        .lte('plan_date', '2026-01-25');

    if (e1) {
        console.error('Error 1:', e1.message);
    } else {
        const counts = d1.reduce((acc, curr) => {
            acc[curr.plan_date] = (acc[curr.plan_date] || 0) + 1;
            return acc;
        }, {});
        console.table(Object.entries(counts).map(([date, count]) => ({ plan_date: date, count })));
    }

    console.log('\n--- Query 2: recent protocol_work_items ---');
    const { data: d2, error: e2 } = await supabase
        .from('protocol_work_items')
        .select('id, title, estimated_minutes, required_people, required_skill_codes, status, created_at')
        .order('created_at', { ascending: false })
        .limit(15);

    if (e2) {
        console.error('Error 2:', e2.message);
    } else {
        console.log(JSON.stringify(d2, null, 2));
    }
}

run();
