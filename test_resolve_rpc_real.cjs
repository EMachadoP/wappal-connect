const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co/rest/v1/rpc/resolve_contact_identity_v6";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function testResolveRpc() {
    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    };

    const payload = {
        p_lid: 'test_lid',
        p_phone: '12345',
        p_chat_lid: null,
        p_chat_id: null
    };

    const res = await new Promise((resolve) => {
        const req = https.request(url, {
            method: 'POST',
            headers
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', () => resolve({ status: 500 }));
        req.write(JSON.stringify(payload));
        req.end();
    });

    console.log(`Status: ${res.status}`);
    console.log(`Response: ${res.data}`);
}

testResolveRpc();
