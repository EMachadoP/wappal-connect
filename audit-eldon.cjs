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

async function auditEldon() {
    console.log('📊 [ELDON AUDIT]');
    try {
        const res = await get('/rest/v1/contacts?chat_key=like.phone%3A5581%25&select=id,name,chat_key,phone');
        console.log('Found contacts starting with 5581:');
        res.forEach(c => {
            if (c.chat_key.includes('97438430')) {
                console.log(`MATCH: ${c.name} | ${c.chat_key} | ${c.id}`);
            } else {
                // log all for context
                console.log(`${c.name} | ${c.chat_key}`);
            }
        });
    } catch (err) {
        console.error('X Error:', err.message);
    }
}

auditEldon();
