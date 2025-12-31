require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const s = createClient('https://qoolzhzdcfnyblymdvbq.supabase.co', 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD');

async function check() {
    const { data, error } = await s.from('ai_logs').select('*').order('id', { ascending: false }).limit(5);
    // Guarantee file creation
    const content = error ? { error } : (data || []);
    fs.writeFileSync('logs_dump.json', JSON.stringify(content, null, 2));
    console.log('Logs dumped');
}

check();
