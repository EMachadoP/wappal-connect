const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`
};

function get(reqPath) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(url + reqPath);
        const options = {
            hostname: fullUrl.hostname,
            path: fullUrl.pathname + fullUrl.search,
            method: 'GET',
            headers: headers
        };
        https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject).end();
    });
}

async function run() {
    console.log('🔍 [PRE-CHECK]');
    try {
        const uRes = await get('/rest/v1/conversations?thread_key=like.u%3A*');
        console.log(`U_COUNT: ${uRes.length}`);

        const eldonRes = await get('/rest/v1/conversations?chat_id=ilike.*558197438430*&select=id,thread_key,contact_id');
        console.log('\n🔍 Eldon Conversations:');
        console.table(eldonRes);
    } catch (err) {
        console.error('X Error:', err.message);
    }
}

run();
