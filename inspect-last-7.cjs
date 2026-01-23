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
        const uRes = await get('/rest/v1/conversations?thread_key=like.u%3A*&select=id,thread_key,contact_id');
        console.log('Remaining Legacy Records:', uRes);

        for (const u of uRes) {
            const msgs = await get(`/rest/v1/messages?conversation_id=eq.${u.id}&select=count`, { count: 'exact' });
            console.log(`Conv ${u.id} has ${msgs.length} messages (REST format)`);
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}
run();
