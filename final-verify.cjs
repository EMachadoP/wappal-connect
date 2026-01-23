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

async function runFinalVerification() {
    console.log('🧪 [FINAL VERIFICATION]');
    try {
        // 1. U remaining
        const uRes = await get('/rest/v1/conversations?thread_key=like.u%3A*&select=id');
        console.log(`U_REMAINING: ${uRes.length}`);

        // 2. Duplicates by contact_id
        // (Harder in REST without RPC/PSQL, but we can verify Eldon's and a general count check)
        const allRes = await get('/rest/v1/conversations?select=contact_id');
        const contactMap = {};
        let duplicateContacts = 0;
        allRes.forEach(c => {
            if (c.contact_id) {
                contactMap[c.contact_id] = (contactMap[c.contact_id] || 0) + 1;
                if (contactMap[c.contact_id] === 2) duplicateContacts++;
            }
        });
        console.log(`CONTACT_ID_DUPLICATES: ${duplicateContacts}`);

        // 3. Duplicates by thread_key
        const threadMap = {};
        let duplicateThreads = 0;
        const allThreads = await get('/rest/v1/conversations?select=thread_key');
        allThreads.forEach(c => {
            if (c.thread_key) {
                threadMap[c.thread_key] = (threadMap[c.thread_key] || 0) + 1;
                if (threadMap[c.thread_key] === 2) duplicateThreads++;
            }
        });
        console.log(`THREAD_KEY_DUPLICATES: ${duplicateThreads}`);

    } catch (err) {
        console.error('X Error:', err.message);
    }
}

runFinalVerification();
