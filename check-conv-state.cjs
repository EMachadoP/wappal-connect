const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
};

async function checkConvState() {
    console.log('🔍 [CHECKING CONV STATE]');
    try {
        const msgs = await new Promise((resolve, reject) => {
            https.get(`${url}/rest/v1/messages?conversation_id=eq.cf2338de-a135-496b-9c91-367941fad487&order=created_at.desc&limit=10`, { headers }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        console.log(JSON.stringify(msgs, null, 2));

    } catch (err) {
        console.error('X Error:', err.message);
    }
}

checkConvState();
