require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const s = createClient('https://qoolzhzdcfnyblymdvbq.supabase.co', 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD');

async function check() {
    const { data } = await s.from('zapi_settings').select('*');
    console.log('Total records:', data.length);
    data.forEach((r, i) => {
        console.log(`\nRecord ${i + 1}:`);
        console.log('  Instance:', r.zapi_instance_id);
        console.log('  Token:', r.zapi_token?.substring(0, 10) + '...');
        console.log('  Security Token:', r.zapi_security_token);
    });
}

check();
