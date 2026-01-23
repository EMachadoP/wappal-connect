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
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runBackfill() {
    console.log('🚀 Starting Robust Backfill (u: -> dm:)');

    try {
        const legacyConv = await request('GET', '/rest/v1/conversations?thread_key=like.u%3A*&select=id,contact_id,thread_key');
        console.log(`Found ${legacyConv.length} legacy conversations.`);

        for (const u of legacyConv) {
            if (!u.contact_id) continue;

            const canonicalKey = `dm:${u.contact_id}`;
            const dmCheck = await request('GET', `/rest/v1/conversations?thread_key=eq.${canonicalKey}&select=id`);

            if (dmCheck.length > 0) {
                const targetId = dmCheck[0].id;
                console.log(`Merge: ${u.thread_key} (${u.id}) -> ${canonicalKey} (${targetId})`);

                // Update all referencing tables
                const tables = ['messages', 'message_outbox', 'conversation_labels', 'protocols', 'tickets'];
                for (const table of tables) {
                    try {
                        await request('PATCH', `/rest/v1/${table}?conversation_id=eq.${u.id}`, { conversation_id: targetId });
                    } catch (e) {
                        // ignore if table doesn't exist or column doesn't exist
                    }
                }

                // Delete old conversation
                try {
                    await request('DELETE', `/rest/v1/conversations?id=eq.${u.id}`);
                } catch (e) {
                    console.error(`Failed to delete ${u.id}: ${e.message}`);
                }
            } else {
                console.log(`Rename: ${u.thread_key} -> ${canonicalKey}`);
                await request('PATCH', `/rest/v1/conversations?id=eq.${u.id}`, { thread_key: canonicalKey });
            }
        }

        console.log('✅ Backfill completed successfully.');
    } catch (err) {
        console.error('❌ Error during backfill:', err.message);
    }
}

runBackfill();
