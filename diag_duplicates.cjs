const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function runDiagnostic() {
    try {
        const headers = {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        };

        const convs = await new Promise((resolve, reject) => {
            https.get(`${url}/rest/v1/conversations?chat_id=eq.558191657140@s.whatsapp.net&select=id,chat_id,thread_key,contact_id,created_at,contacts(name)`, { headers }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        for (const c of convs) {
            const msgCount = await new Promise((resolve, reject) => {
                https.get(`${url}/rest/v1/messages?conversation_id=eq.${c.id}&select=id`, { headers: { ...headers, 'Range-Unit': 'items', 'Range': '0-0', 'Prefer': 'count=exact' } }, (res) => {
                    const count = res.headers['content-range']?.split('/')[1];
                    resolve(parseInt(count || '0'));
                }).on('error', reject);
            });
            c.msg_count = msgCount;
        }

        console.log('JSON_RESULT_START');
        console.log(JSON.stringify(convs.map(c => ({
            id: c.id,
            chat_id: c.chat_id,
            thread_key: c.thread_key,
            contact_id: c.contact_id,
            name: c.contacts?.name || 'N/A',
            msg_count: c.msg_count,
            created_at: c.created_at
        })), null, 2));
        console.log('JSON_RESULT_END');

    } catch (err) {
        console.error('Error:', err.message);
    }
}

runDiagnostic();
