require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://qoolzhzdcfnyblymdvbq.supabase.co',
    'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function fetchErrorLogs() {
    const { data, error } = await supabase
        .from('ai_logs')
        .select('*')
        .eq('status', 'error')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error fetching logs:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No error logs found');
        return;
    }

    console.log(`Found ${data.length} error logs:\n`);

    data.forEach((log, i) => {
        console.log(`\n=== ERROR LOG ${i + 1} ===`);
        console.log('Time:', log.created_at);
        console.log('Model:', log.model);
        console.log('Provider:', log.provider);
        console.log('Conversation ID:', log.conversation_id || 'N/A');
        console.log('Error Message:', log.error_message);
        if (log.input_excerpt) {
            console.log('Input (first 200 chars):', log.input_excerpt.substring(0, 200));
        }
        console.log('='.repeat(50));
    });
}

fetchErrorLogs();
