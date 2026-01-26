const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function clearPause() {
    try {
        const headers = {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        };

        const contactId = "50d3c381-d62c-494a-932b-f29801ca7736";
        const convId = "095d7134-602c-43c8-becb-221f995ae8d1";

        const res = await new Promise((resolve, reject) => {
            const req = https.request(`${url}/rest/v1/conversations?id=eq.${convId}`, {
                method: 'PATCH',
                headers
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(res.statusCode));
            });
            req.on('error', reject);
            req.write(JSON.stringify({
                ai_paused_until: null,
                ai_mode: 'AUTO'
            }));
            req.end();
        });

        console.log(`--- CLEARED PAUSE FOR CONV ${convId} (Status: ${res}) ---`);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

clearPause();
