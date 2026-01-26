const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function checkRPCs() {
    const rpcs = [
        'acquire_conversation_lock',
        'release_conversation_lock',
        'resolve_contact_identity_v6'
    ];

    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    };

    for (const rpc of rpcs) {
        const res = await new Promise((resolve) => {
            const req = https.request(`${url}/rest/v1/rpc/${rpc}`, {
                method: 'POST',
                headers
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', () => resolve({ status: 500 }));
            // We don't necessarily need valid params just to see if it exists (404 vs 400)
            req.write(JSON.stringify({}));
            req.end();
        });
        console.log(`RPC ${rpc} status: ${res.status}`);
        if (res.status === 404) {
            console.log(`  -> ${rpc} NOT FOUND`);
        } else if (res.status === 400) {
            console.log(`  -> ${rpc} FOUND (returned 400 due to missing params)`);
        } else if (res.status === 200) {
            console.log(`  -> ${rpc} FOUND and executed (with default or no params)`);
        } else {
            console.log(`  -> ${rpc} returned ${res.status}: ${res.data}`);
        }
    }
}

checkRPCs();
