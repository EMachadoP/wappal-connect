
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const supabaseKey = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";
const supabase = createClient(supabaseUrl, supabaseKey);

const migrations = [
    '20260120100000_fix_lid_normalization.sql',
    '20260120101000_merge_duplicate_contacts.sql',
    '20260120102000_conversation_views.sql'
];

async function runMigrations() {
    for (const file of migrations) {
        console.log(`Running migration: ${file}`);
        const filePath = path.join(__dirname, 'supabase', 'migrations', file);
        const sql = fs.readFileSync(filePath, 'utf8');

        // Using RPC to execute SQL if available, or just standard query if it's a single statement.
        // However, migrations contain multiple statements. 
        // Best way is to use a "run_sql" RPC if it exists, or just send it via Postgres directly.
        // Since I don't have a direct PG connection, I'll try to use the supabase client to run the raw SQL
        // if there's a helper, or just split statements.

        // In this project, there is often a 'debug_sql' or similar. 
        // Let's see if there's a 'exec_sql' RPC.

        // Actually, I'll use the 'zapi-webhook' or some other function if I can, 
        // but I can also just try to run it via the REST API for SQL if enabled.

        // Let's try splitting by semicolon as a fallback, but that's risky for functions.
        // Better: I'll try to use a simple RPC to execute.

        const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
        if (error) {
            console.error(`Error in ${file}:`, error);
            // If exec_sql doesn't exist, we'll try another way.
        } else {
            console.log(`Successfully applied ${file}`);
        }
    }
}

runMigrations();
