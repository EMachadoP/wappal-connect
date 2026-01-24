const https = require('https');
const url = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const key = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';
const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
};

async function check() {
    const id = 'cf2338de-a135-496b-9c91-367941fad487';
    const tables = [
        'ai_logs',
        'ai_conversation_locks',
        'message_transcripts',
        'notifications',
        'message_media',
        'conversation_participants',
        'conversation_participant_state',
        'messages',
        'protocols'
    ];

    for (const t of tables) {
        try {
            const endpoint = `${url}/rest/v1/${t}?conversation_id=eq.${id}&select=id`;
            const res = await new Promise((resolve, reject) => {
                https.get(endpoint, { headers }, (res) => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch (e) { resolve([]); }
                    });
                }).on('error', reject);
            });
            if (res.length > 0) console.log(`${t} has ${res.length} matches`);
        } catch (e) {
            // Table might not exist or doesn't have conversation_id
        }
    }
}

check().catch(console.error);
