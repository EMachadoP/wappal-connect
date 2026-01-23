const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
};

async function checkGroupMessages() {
    console.log('🔍 [CHECKING GROUP MESSAGES]');
    try {
        // Find messages in the last hour
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const msgs = await new Promise((resolve, reject) => {
            https.get(`${url}/rest/v1/messages?chat_id=ilike.*gus*&created_at=gte.${hourAgo}&order=created_at.desc`, { headers }, (res) => {
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

checkGroupMessages();
