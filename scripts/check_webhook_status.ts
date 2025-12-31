
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkStatus() {
    console.log('--- VERIFICANDO STATUS DO WEBHOOK ---');

    const { data: settings } = await supabase
        .from('zapi_settings')
        .select('last_webhook_received_at')
        .is('team_id', null)
        .maybeSingle();

    console.log('Último sinal de vida (last_webhook_received_at):', settings?.last_webhook_received_at);

    console.log('\n--- ÚLTIMAS 5 MENSAGENS NO BANCO ---');
    const { data: messages } = await supabase
        .from('messages')
        .select('id, content, sender_type, direction, sent_at')
        .order('sent_at', { ascending: false })
        .limit(5);

    if (messages && messages.length > 0) {
        messages.forEach(m => {
            console.log(`[${m.sent_at}] ${m.direction === 'inbound' ? 'IN' : 'OUT'} | ${m.sender_type}: ${m.content}`);
        });
    } else {
        console.log('Nenhuma mensagem encontrada.');
    }
}

checkStatus();
