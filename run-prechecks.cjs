const fs = require('fs');
const path = require('path');
const https = require('https');

function getEnv() {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const k = parts[0].trim();
            const v = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
            env[k] = v;
        }
    });
    return env;
}

const env = getEnv();
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`
};

function get(reqPath) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(url + reqPath);
        const options = {
            hostname: fullUrl.hostname,
            path: fullUrl.pathname + fullUrl.search,
            method: 'GET',
            headers: headers
        };
        https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject).end();
    });
}

async function run() {
    console.log('🔍 [PRE-CHECK]');
    try {
        const uRes = await get('/rest/v1/conversations?thread_key=like.u%3A*');
        console.log(`U_COUNT: ${uRes.length}`);

        const eldonRes = await get('/rest/v1/conversations?chat_id=ilike.*558197438430*&select=id,thread_key,contact_id');
        console.log('\n🔍 Eldon Conversations:');
        console.table(eldonRes);
    } catch (err) {
        console.error('X Error:', err.message);
    }
}

run();
