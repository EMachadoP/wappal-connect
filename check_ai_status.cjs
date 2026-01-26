const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function checkSchema() {
    try {
        const headers = {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Prefer': 'count=exact'
        };

        const res = await new Promise((resolve, reject) => {
            const req = https.request(`${url}/rest/v1/ai_logs?limit=1`, {
                method: 'GET',
                headers
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null }));
            });
            req.on('error', reject);
            req.end();
        });

        console.log(`Status: ${res.status}`);
        if (res.data && res.data.length > 0) {
            console.log('Columns:', Object.keys(res.data[0]));
        } else {
            console.log('No data found to determine columns.');
        }

    } catch (err) {
        console.error('Error:', err.message);
    }
}

checkSchema();
