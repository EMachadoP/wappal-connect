const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
};

async function checkConversation() {
    console.log('🔍 [CHECKING CONVERSATION]');
    try {
        // 1. Find conversation with contact_id = '91a956f9-da0a-427d-a1b3-da5e1311a208'
        const conversations = await new Promise((resolve, reject) => {
            https.get(`${url}/rest/v1/conversations?contact_id=eq.91a956f9-da0a-427d-a1b3-da5e1311a208&select=*`, { headers }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        console.log('Conversations for Elias:', JSON.stringify(conversations, null, 2));

    } catch (err) {
        console.error('X Error:', err.message);
    }
}

checkConversation();
