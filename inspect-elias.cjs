const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
};

async function inspectElias() {
    console.log('🔍 [INSPECTING ELIAS]');
    try {
        // 1. Find contact Elias
        const contacts = await new Promise((resolve, reject) => {
            https.get(`${url}/rest/v1/contacts?name=ilike.*Elias*&select=id,name,phone`, { headers }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        if (!contacts || contacts.length === 0) {
            console.log('X Elias not found in contacts');
            return;
        }

        const elias = contacts[0];
        console.log('Found Elias:', elias);

        // 2. Check participants for this contact
        const participants = await new Promise((resolve, reject) => {
            https.get(`${url}/rest/v1/participants?contact_id=eq.${elias.id}&select=*,entities(name)`, { headers }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        console.log('Participants for Elias:', JSON.stringify(participants, null, 2));

    } catch (err) {
        console.error('X Error:', err.message);
    }
}

inspectElias();
