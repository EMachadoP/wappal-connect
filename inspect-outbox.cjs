const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

function get(reqPath) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(url + reqPath);
        https.request({
            hostname: fullUrl.hostname,
            path: fullUrl.pathname + fullUrl.search,
            method: 'GET',
            headers: headers
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject).end();
    });
}

async function run() {
    try {
        const columns = await get('/rest/v1/message_outbox?limit=1');
        console.log('Sample record from message_outbox:', columns);
    } catch (err) {
        console.error('Error:', err.message);
    }
}
run();
