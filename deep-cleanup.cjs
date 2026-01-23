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

async function runCleanup() {
    console.log('🚀 Starting Deep Cleanup');

    try {
        // 1. Handle ALL u: conversations (even without contact_id)
        const legacyConv = await request('GET', '/rest/v1/conversations?thread_key=like.u%3A*&select=id,contact_id,thread_key');
        for (const u of legacyConv) {
            if (!u.contact_id) {
                // Check if it has messages
                const msgCheck = await request('GET', `/rest/v1/messages?conversation_id=eq.${u.id}&limit=1&select=id`);
                if (msgCheck.length === 0) {
                    console.log(`Deleting empty legacy conv without contact: ${u.id}`);
                    await request('DELETE', `/rest/v1/conversations?id=eq.${u.id}`);
                } else {
                    console.log(`Legacy conv ${u.id} HAS messages but NO contact_id. Skipping for safety.`);
                }
            }
        }

        // 2. Identify Contact Duplicates
        const allConv = await request('GET', '/rest/v1/conversations?select=id,contact_id,thread_key');
        const contactMap = {};
        allConv.forEach(c => {
            if (c.contact_id) {
                if (!contactMap[c.contact_id]) contactMap[c.contact_id] = [];
                contactMap[c.contact_id].push(c);
            }
        });

        for (const contactId in contactMap) {
            const list = contactMap[contactId];
            if (list.length > 1) {
                console.log(`Contact ${contactId} has ${list.length} conversations. Merging...`);

                // Identify canonical (prefer dm:UUID)
                let target = list.find(c => c.thread_key === `dm:${contactId}`);
                if (!target) target = list[0]; // fallback to first one

                for (const source of list) {
                    if (source.id === target.id) continue;

                    console.log(`  Merging ${source.thread_key} (${source.id}) -> ${target.thread_key} (${target.id})`);

                    const tables = ['messages', 'message_outbox', 'conversation_labels', 'protocols', 'tickets'];
                    for (const table of tables) {
                        try {
                            await request('PATCH', `/rest/v1/${table}?conversation_id=eq.${source.id}`, { conversation_id: target.id });
                        } catch (e) { }
                    }

                    try {
                        await request('DELETE', `/rest/v1/conversations?id=eq.${source.id}`);
                    } catch (e) {
                        console.error(`  Failed to delete ${source.id}: ${e.message}`);
                    }
                }
            }
        }

        console.log('✅ Deep Cleanup completed.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

runCleanup();
