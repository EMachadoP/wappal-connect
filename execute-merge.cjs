const https = require('https');

const SUPABASE_URL = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const SUPABASE_KEY = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
};

async function patch(table, id, body) {
    const options = {
        method: 'PATCH',
        headers: headers
    };
    return new Promise((resolve, reject) => {
        const req = https.request(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, options, (res) => {
            res.on('data', () => { });
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function del(table, id, col = 'id') {
    const options = {
        method: 'DELETE',
        headers: headers
    };
    return new Promise((resolve, reject) => {
        const req = https.request(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${id}`, options, (res) => {
            res.on('data', () => { });
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end();
    });
}

async function getCount(table, conversationId) {
    return new Promise((resolve, reject) => {
        https.get(`${SUPABASE_URL}/rest/v1/${table}?conversation_id=eq.${conversationId}&select=id`, { headers }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data).length));
        }).on('error', reject);
    });
}

async function merge() {
    const target = 'c6399bc0-f0bc-4d86-8a10-827f7a71a3af'; // Con hífen
    const source = 'cf2338de-a135-496b-9c91-367941fad487'; // Sem hífen

    console.log(`🔍 Checking source (${source}) and target (${target})...`);
    const sCount = await getCount('messages', source);
    const tCount = await getCount('messages', target);
    console.log(`Source has ${sCount} messages. Target has ${tCount} messages.`);

    if (sCount > 0) {
        console.log(`🚀 Moving ${sCount} messages to target...`);
        const status = await patch('messages', 'ANY', { conversation_id: target });
        // Wait, patch with filter in URL replaces ALL matching rows
        // But the helper `patch` I wrote uses `?id=eq.${id}` which is wrong for bulk.
    }
}

// Rewriting for bulk
async function bulkUpdate(table, filter, body) {
    const options = {
        method: 'PATCH',
        headers: headers
    };
    return new Promise((resolve, reject) => {
        const req = https.request(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, options, (res) => {
            res.on('data', () => { });
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function executeMerge() {
    const target = 'c6399bc0-f0bc-4d86-8a10-827f7a71a3af';
    const source = 'cf2338de-a135-496b-9c91-367941fad487';

    console.log('--- MERGE START ---');

    console.log('1. Moving messages...');
    const mStatus = await bulkUpdate('messages', `conversation_id=eq.${source}`, { conversation_id: target });
    console.log(`Messages update status: ${mStatus}`);

    console.log('2. Moving protocols...');
    const pStatus = await bulkUpdate('protocols', `conversation_id=eq.${source}`, { conversation_id: target });
    console.log(`Protocols update status: ${pStatus}`);

    console.log('3. Deleting dependent records...');
    await del('message_outbox', source, 'conversation_id');
    await del('conversation_participant_state', source, 'conversation_id');
    await del('conversation_participants', source, 'conversation_id');

    console.log('4. Updating target metadata...');
    const tStatus = await bulkUpdate('conversations', `id=eq.${target}`, {
        title: 'G7 Serv Grupo',
        is_group: true
    });
    console.log(`Target metadata update status: ${tStatus}`);

    console.log('5. Deleting source conversation...');
    const dStatus = await del('conversations', source, 'id');
    console.log(`Delete status: ${dStatus}`);

    console.log('--- MERGE COMPLETE ---');
}

executeMerge().catch(console.error);
