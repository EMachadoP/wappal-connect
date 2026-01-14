
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1OTI3NjgsImV4cCI6MjA4MjE2ODc2OH0.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase.from('conversations').select('*').limit(1);

    if (error) {
        console.error('Error:', error.message);
    } else if (data && data.length > 0) {
        console.log('Conversations columns:');
        console.log(Object.keys(data[0]));
        console.log('\ncondominium_id exists?', Object.keys(data[0]).includes('condominium_id') ? 'SIM' : 'NÃO');
    } else {
        console.log('No conversations found, trying empty table check...');
        // Try info_schema if no data
    }
}

run();
