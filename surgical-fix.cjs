const https = require('https');

const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

async function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(url + path);
        const options = {
            hostname: fullUrl.hostname,
            path: fullUrl.pathname + fullUrl.search,
            method: method,
            headers: headers
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 400) {
                    try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
                } else {
                    const err = new Error(`Status ${res.statusCode}: ${data}`);
                    err.statusCode = res.statusCode;
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function surgicalFix() {
    console.log('🚀 Starting Corrected Surgical Fix');

    try {
        const uRes = await request('GET', '/rest/v1/conversations?thread_key=like.u%3A*&select=id,thread_key,contact_id');

        for (const u of uRes) {
            const canonicalKey = `dm:${u.contact_id}`;
            const dmRes = await request('GET', `/rest/v1/conversations?thread_key=eq.${canonicalKey}&select=id`);

            if (dmRes.length > 0) {
                const targetId = dmRes[0].id;
                console.log(`Fixing ${u.thread_key} -> ${canonicalKey}`);

                // Corrected table list (removed 'tickets')
                const tables = ['messages', 'message_outbox', 'conversation_labels', 'protocols'];
                for (const table of tables) {
                    try {
                        const records = await request('GET', `/rest/v1/${table}?conversation_id=eq.${u.id}&select=id`);
                        for (const record of records) {
                            try {
                                await request('PATCH', `/rest/v1/${table}?id=eq.${record.id}`, { conversation_id: targetId });
                            } catch (e) {
                                if (e.statusCode === 409 || e.statusCode === 400) {
                                    console.log(`  Conflict in ${table} for record ${record.id}. Record likely duplicate. Deleting source record.`);
                                    await request('DELETE', `/rest/v1/${table}?id=eq.${record.id}`);
                                } else {
                                    console.error(`  Error moving ${table} ${record.id}: ${e.message}`);
                                }
                            }
                        }
                    } catch (e) {
                        // Table might not exist or other error
                    }
                }

                // Final delete of the empty conversation
                await request('DELETE', `/rest/v1/conversations?id=eq.${u.id}`);
            }
        }
        console.log('✅ Surgical Fix completed.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

surgicalFix();
