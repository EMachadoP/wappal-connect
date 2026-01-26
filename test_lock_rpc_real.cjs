const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co/rest/v1/rpc/acquire_conversation_lock";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function testLockRpc() {
    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    };

    const payload = {
        p_conversation_id: '6cdd9f2b-e01e-4ace-b199-44962ac70304',
        p_ttl_seconds: 1
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

testLockRpc();
