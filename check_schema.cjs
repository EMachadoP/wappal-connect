
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- Checking Technicians Columns ---');
    const { data: d1, error: e1 } = await supabase.rpc('get_table_columns', { table_name_input: 'technicians' });
    if (e1) {
        // Fallback if RPC doesn't exist
        const { data: d1_fb, error: e1_fb } = await supabase.from('technicians').select('*').limit(1);
        if (e1_fb) console.error('Error technicians:', e1_fb.message);
        else console.log('Technicians columns:', Object.keys(d1_fb[0] || {}));
    } else {
        console.table(d1);
    }

    console.log('\n--- Checking protocol_work_items Columns ---');
    const { data: d2, error: e2 } = await supabase.rpc('get_table_columns', { table_name_input: 'protocol_work_items' });
    if (e2) {
        const { data: d2_fb, error: e2_fb } = await supabase.from('protocol_work_items').select('*').limit(1);
        if (e2_fb) console.error('Error protocol_work_items:', e2_fb.message);
        else console.log('protocol_work_items columns:', Object.keys(d2_fb[0] || {}));
    } else {
        console.table(d2);
    }
}

run();
