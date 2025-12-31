require('dotenv').config();
const https = require('https');

const url = new URL('https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/zapi-send-message');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!key) {
    console.error("No Key found");
    process.exit(1);
}

function req(method) {
    const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: method,
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        }
    };

    const req = https.request(options, res => {
        console.log(`${method} STATUS: ${res.statusCode}`);
        console.log(`${method} HEADERS:`, JSON.stringify(res.headers));
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
            console.log(`${method} BODY:`, body);
        });
    });

    req.on('error', e => console.error(`${method} ERROR:`, e.message));
    if (method === 'POST') req.write('{}');
    req.end();
}

req('OPTIONS');
req('POST');
