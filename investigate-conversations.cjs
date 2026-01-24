const https = require('https');
const url = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const key = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';
const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
};

async function check() {
    const endpoint = `${url}/rest/v1/conversations?select=id,title,chat_id,thread_key,last_message,last_message_at,contacts(name)&order=last_message_at.desc&limit=50`;

    const res = await new Promise((resolve, reject) => {
        https.get(endpoint, { headers }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });

    console.log('ID | NAME | CHAT_ID | THREAD_KEY | LAST_MESSAGE_EXCERPT');
    console.log('-------------------------------------------------------');
    res.forEach(c => {
        const contactName = c.contacts && c.contacts.name;
        const name = c.title || contactName || 'Sem Nome';
        const last = (c.last_message || '').substring(0, 40).replace(/\n/g, ' ');
        console.log(`${c.id} | ${name} | ${c.chat_id} | ${c.thread_key} | ${last}`);
    });
}

check().catch(console.error);
