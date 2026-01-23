const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
};

const sql = `
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='contacts'
  and column_name in ('created_at','updated_at','chat_key','chat_lid','lid','name')
order by column_name;
`;

function post(reqPath, body) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(url + reqPath);
        const req = https.request({
            hostname: fullUrl.hostname,
            path: fullUrl.pathname,
            method: 'POST',
            headers: headers
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function checkSchema() {
    console.log('🔍 [SCHEMA CHECK]');
    try {
        // We might not have a direct SQL endpoint if it's not enabled or key is limited.
        // But usually there is one in some setups. Let's try the RPC /rest/v1/rpc/check_schema if I had one?
        // Wait, I can just query the information_schema via standard REST if it's exposed?
        // Actually, Supabase usually doesn't expose information_schema via REST.

        // I'll try to just select from contacts and see what I get in the columns.
        const res = await new Promise((resolve, reject) => {
            https.get(`${url}/rest/v1/contacts?select=*&limit=1`, { headers }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        if (res && res.length > 0) {
            const cols = Object.keys(res[0]);
            console.log('Columns found in contacts:', cols);
            const hasCreated = cols.includes('created_at');
            const hasUpdated = cols.includes('updated_at');
            console.log(`- created_at: ${hasCreated}`);
            console.log(`- updated_at: ${hasUpdated}`);
        } else {
            console.log('No records found to check columns, trying a different approach...');
        }
    } catch (err) {
        console.error('X Error:', err.message);
    }
}

checkSchema();
