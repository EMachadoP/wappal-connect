const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/ai-maybe-reply";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function testEdgeFunction() {
    const headers = {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    };

    const payload = {
        conversation_id: '6cdd9f2b-e01e-4ace-b199-44962ac70304'
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

testEdgeFunction();
