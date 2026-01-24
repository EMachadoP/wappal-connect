const https = require('https');
const url = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const key = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';
const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
};

async function attemptDelete() {
    const id = 'cf2338de-a135-496b-9c91-367941fad487';
    const endpoint = `${url}/rest/v1/conversations?id=eq.${id}`;

    const options = {
        method: 'DELETE',
        headers: headers
    };

    console.log(`🗑️ Attempting to delete conversation ${id}...`);

    return new Promise((resolve, reject) => {
        const req = https.request(endpoint, options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                console.log(`Status: ${res.statusCode}`);
                console.log(`Body: ${data}`);
                resolve({ status: res.statusCode, body: data });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

attemptDelete().catch(console.error);
