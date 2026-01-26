const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

async function checkDuplicates() {
    const query = encodeURIComponent('select chat_id, count(*) from conversations where chat_id is not null group by chat_id having count(*) > 1');
    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`
    };

    // Since I can't run raw SQL via REST unless there's an RPC, 
    // I'll check if 'exec_sql' exists or just query all chat_ids and count in JS.
    // Given the amount of data, querying all might be slow.

    // Let's try to see if 'exec_sql' exists first.
    const res = await new Promise((resolve) => {
        const req = https.request(`${url}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', () => resolve({ status: 500 }));
        req.write(JSON.stringify({ sql_query: 'SELECT 1 as result' }));
        req.end();
    });

    console.log(`RPC exec_sql status: ${res.status}`);
    if (res.status === 200) {
        console.log('exec_sql is available.');
        const { data } = await new Promise((resolve) => {
            const req = https.request(`${url}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ data: JSON.parse(data) }));
            });
            req.write(JSON.stringify({ sql_query: 'select chat_id, count(*) from conversations where chat_id is not null group by chat_id having count(*) > 1' }));
            req.end();
        });
        console.log('Duplicates found:', data);
    } else {
        console.log('exec_sql is NOT available. Falling back to fetching all chat_ids...');
        // Fallback: Fetch all chat_ids
        // But let's try 'debug_sql' or something else if it might exist.
    }
}

checkDuplicates();
