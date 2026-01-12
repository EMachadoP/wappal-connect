import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key.trim()] = value.trim();
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables (URL/SERVICE_ROLE_KEY)');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
    console.log('Applying migration: ALTER TABLE protocols ADD COLUMN IF NOT EXISTS condominium_name TEXT;');

    // Using direct SQL via rpc if available, or just testing with a query
    const { data, error } = await supabase.rpc('execute_sql', {
        sql_query: 'ALTER TABLE protocols ADD COLUMN IF NOT EXISTS condominium_name TEXT;'
    });

    if (error) {
        console.error('Error applying migration via RPC:', error);
        console.log('Trying another way...');

        // Fallback: This will only work if the user has a specific RPC for this or via another method.
        // In many Supabase setups, you can't run DDL via client unless you have a custom function.
    } else {
        console.log('Migration applied successfully!');
    }
}

applyMigration();
