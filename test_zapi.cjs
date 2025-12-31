require('dotenv').config();
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient('https://qoolzhzdcfnyblymdvbq.supabase.co', 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD');

async function check() {
    const { data } = await supabase.from('zapi_settings').select('*').single();
    if (!data) {
        console.log('No settings found');
        return;
    }

    console.log('Testing Direct Z-API Call locally...');
    const payload = JSON.stringify({
        phone: '558197438430',
        message: 'Test Request from User PC'
    });

    const options = {
        hostname: 'api.z-api.io',
        path: `/instances/${data.zapi_instance_id}/token/${data.zapi_token}/send-text`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Client-Token': data.zapi_security_token,
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => console.log('DIRECT_RES:', body));
    });

    req.on('error', e => console.error(e));
    req.write(payload);
    req.end();
}

check();
