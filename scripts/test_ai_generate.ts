import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testGenerate() {
    console.log('Testing ai-generate-reply directly...');
    const { data, error } = await supabase.functions.invoke('ai-generate-reply', {
        body: {
            messages: [{ role: 'user', content: 'Oi, teste de conexão.' }],
            systemPrompt: 'Você é um assistente de teste.',
            ragEnabled: false
        },
    });

    if (error) {
        console.error('Invoke Error:', error);
        try {
            const body = await error.context.json();
            console.error('Error Body:', JSON.stringify(body, null, 2));
        } catch (e) {
            // Not JSON or no context
        }
    } else {
        console.log('Success Data:', JSON.stringify(data, null, 2));
    }
}

testGenerate();
