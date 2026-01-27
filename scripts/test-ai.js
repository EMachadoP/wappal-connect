
const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    process.exit(1);
}

const functionUrl = `${SUPABASE_URL}/functions/v1/ai-generate-reply`;

async function testScenario(name, payload) {
    console.log(`\n--- Scenario: ${name} ---`);
    try {
        const response = await axios.post(functionUrl, payload, {
            headers: {
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Response:', response.data.text);
        console.log('Reason:', response.data.finish_reason);
    } catch (err) {
        console.error('Error:', err.response?.data || err.message);
    }
}

async function runTests() {
    // Test 1: Ambiguous match (should now match first)
    // We'll use a likely name. Assuming "Sonata" exists in DB.
    await testScenario('Partial Match (Ambiguous to Match)', {
        messages: [
            { role: 'user', content: 'O portão não abre' },
            { role: 'assistant', content: 'Qual o nome do seu condomínio?' },
            { role: 'user', content: 'Sonata' }
        ],
        conversation_id: '00000000-0000-0000-0000-000000000000' // Mock ID
    });

    // Test 2: Unknown Condo (should accept raw)
    await testScenario('Unknown Condo (Skip Reprompt)', {
        messages: [
            { role: 'user', content: 'Cerca com problema' },
            { role: 'assistant', content: 'Certo, qual o seu condomínio?' },
            { role: 'user', content: 'Condomínio inexistente 123' }
        ],
        conversation_id: '00000000-0000-0000-0000-000000000001'
    });
}

runTests();
