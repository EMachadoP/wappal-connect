require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseServiceKey = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function test() {
    // Simular o que a função faz
    const { data: settings } = await supabaseAdmin.from('zapi_settings').select('*').limit(1).single();

    // Prioridade: Env Var > Banco (igual ao código da função)
    const instanceId = process.env.ZAPI_INSTANCE_ID || settings?.zapi_instance_id;
    const token = process.env.ZAPI_TOKEN || settings?.zapi_token;
    const clientToken = process.env.ZAPI_CLIENT_TOKEN || settings?.zapi_security_token;

    console.log('Instance ID:', instanceId);
    console.log('Token:', token?.substring(0, 10) + '...');
    console.log('Client-Token (usado):', clientToken);
    console.log('\nEnv vars:');
    console.log('  ZAPI_CLIENT_TOKEN:', process.env.ZAPI_CLIENT_TOKEN || '(not set)');
    console.log('  From DB:', settings?.zapi_security_token);
}

test();
