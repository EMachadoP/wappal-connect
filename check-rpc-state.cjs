const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
};

async function checkRpcDefinition() {
    console.log('🔍 [CHECKING RPC DEFINITION]');
    try {
        // We check using a query on information_schema or just try to invoke it with a test case
        const body = {
            p_lid: 'test',
            p_phone: 'test',
            p_chat_lid: 'test',
            p_chat_id: 'test'
        };

        const postData = JSON.stringify(body);
        const options = {
            hostname: 'qoolzhzdcfnyblymdvbq.supabase.co',
            port: 443,
            path: '/rest/v1/rpc/resolve_contact_identity',
            method: 'POST',
            headers: {
                ...headers,
                'Content-Length': postData.length
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log('Response status:', res.statusCode);
                console.log('Response body:', data);
            });
        });

        req.on('error', (e) => console.error(e));
        req.write(postData);
        req.end();

    } catch (err) {
        console.error('X Error:', err.message);
    }
}

checkRpcDefinition();
