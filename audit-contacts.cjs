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

async function runAudit() {
    console.log('📊 [CONTACT AUDIT]');
    try {
        const allRes = await get('/rest/v1/contacts?select=id,name,chat_key,phone');

        console.log('--- BR 12-digit contacts (Candidates for +9) ---');
        const br12 = allRes.filter(c => {
            const digits = (c.chat_key || "").replace(/\D/g, "");
            return digits.startsWith('55') && digits.length === 12;
        });
        br12.forEach(c => console.log(`${c.name} | ${c.chat_key} | ${c.id}`));

        console.log('\n--- BR 13-digit contacts ---');
        const br13 = allRes.filter(c => {
            const digits = (c.chat_key || "").replace(/\D/g, "");
            return digits.startsWith('55') && digits.length === 13;
        });
        br13.forEach(c => console.log(`${c.name} | ${c.chat_key} | ${c.id}`));

    } catch (err) {
        console.error('X Error:', err.message);
    }
}

runAudit();
