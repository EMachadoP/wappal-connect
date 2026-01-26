const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function testExecuteSql() {
    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    };

    const res = await new Promise((resolve) => {
        const req = https.request(`${url}/rest/v1/rpc/execute_sql`, {
            method: 'POST',
            headers
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', () => resolve({ status: 500 }));
        req.write(JSON.stringify({ sql_query: 'SELECT 1 as test' }));
        req.end();
    });

    console.log(`RPC execute_sql status: ${res.status}`);
    console.log(`Response: ${res.data}`);
}

testExecuteSql();
