const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co/rest/v1/ai_logs?order=created_at.desc&limit=5";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function fetchLogs() {
    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`
    };

    const res = await new Promise((resolve) => {
        const req = https.request(url, { headers }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.end();
    });

    console.log(JSON.stringify(res, null, 2));
}

fetchLogs();
