import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testAITest() {
    console.log('Testing ai-test...');
    const { data, error } = await supabase.functions.invoke('ai-test', {
        body: {
            message: 'Teste06',
            teamId: null,
            providerId: 'dc3bd2fc-1b29-423d-a121-90329f8978d2' // Gemini ID
        },
    });

    if (error) {
        console.error('Invoke Error:', error);
        try {
            const body = await error.context.json();
            console.error('Error Body:', JSON.stringify(body, null, 2));
        } catch (e) {
            console.error('Raw context text:', await error.context.text());
        }
    } else {
        console.log('Success Data:', JSON.stringify(data, null, 2));
    }
}

testAITest();
