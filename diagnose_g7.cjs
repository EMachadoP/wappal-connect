const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Manually parse .env
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^["']|["']$/g, '');
                process.env[key] = value;
            }
        });
    } else {
        console.warn('⚠️ .env file not found at:', envPath);
    }
} catch (e) {
    console.warn('⚠️ Could not read .env file:', e.message);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY check your .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log('🔍 Diagnosing G7 Serv / Group Duplicates...');

async function run() {
    const { data, error } = await supabase
        .from('conversations')
        .select('id, chat_id, thread_key, contact_name, created_at, status, pending_payload')
        .or('contact_name.ilike.%G7%,contact_name.ilike.%grupo%,chat_id.ilike.%g.us%,thread_key.ilike.%group:%')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('❌ Error:', error);
    } else {
        // Filter specifically for G7 or relevant group behavior to reduce noise
        const relevant = data.filter(c =>
            (c.contact_name && (c.contact_name.includes('G7') || c.contact_name.includes('Serv'))) ||
            (c.chat_id && c.chat_id.includes('g.us'))
        );

        console.log(`Found ${relevant.length} relevant conversations:`);
        console.table(relevant.map(c => ({
            id: c.id,
            chat_id: c.chat_id,
            thread_key: c.thread_key,
            contact_name: c.contact_name,
            created_at: new Date(c.created_at).toLocaleString(),
            status: c.status
        })));
    }
}

run();
