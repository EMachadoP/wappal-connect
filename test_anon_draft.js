require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY; // Need anon key

// If we don't have anon key in env, we can't test "frontend-like" access.
// I'll grab it from a file or assume it's available.
// Viewing config to find anon key if needed... check .env first via dotenv.

if (!supabaseAnonKey) {
    console.error("No ENV found, reading .env manual");
}

const s = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
    console.log('Testing Anon Access...');
    const { data: conv } = await s.from('conversations').select('id').limit(1).single();

    // Login first? Frontend is logged in. 
    // Anon invoke usually works if function allows it, but zapi-send-message checks Auth.
    // So I need to sign in as a user.
    // I'll use a hardcoded login if possible, or just check if I can hit the endpoint at all (even 401 is better than "Failed to send").

    const { error } = await s.functions.invoke('zapi-send-message', {
        body: { conversation_id: conv.id || 'x', content: 'Anon Test', message_type: 'text' }
    });

    if (error) console.log('ANON_RESULT:', error);
    else console.log('ANON_SUCCESS');
}

// Actually better to just use curl to the function URL with Anon Key to see if it Connects.
// URL: https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/zapi-send-message

const fetch = require('node-fetch'); // assuming node-fetch is available or using https
const https = require('https');

function testHttp() {
    const options = {
        hostname: 'qoolzhzdcfnyblymdvbq.supabase.co',
        path: '/functions/v1/zapi-send-message',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
        }
    };
    const req = https.request(options, res => {
        console.log('STATUS:', res.statusCode);
        res.on('data', d => console.log('DATA:', d.toString()));
    });
    req.on('error', e => console.error('REQ_ERR:', e));
    req.write(JSON.stringify({}));
    req.end();
}
// I will not run this partial script. I'll stick to a simple one-liner run_command to curl.
