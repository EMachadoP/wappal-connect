
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkTodayMessages() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    console.log(`--- MENSAGENS DESDE ${todayStr} ---`);

    const { data: messages, error } = await supabase
        .from('messages')
        .select('id, content, sender_type, direction, sent_at, chat_id')
        .gte('sent_at', todayStr)
        .order('sent_at', { ascending: false });

    if (error) {
        console.error('Erro ao buscar mensagens:', error.message);
        return;
    }

    if (messages && messages.length > 0) {
        messages.forEach(m => {
            console.log(`[${m.sent_at}] ${m.direction === 'inbound' ? 'IN' : 'OUT'} | ${m.chat_id}: ${m.content}`);
        });
    } else {
        console.log('Nenhuma mensagem encontrada para hoje.');
    }

    const { data: settings } = await supabase
        .from('zapi_settings')
        .select('*');

    console.log('\n--- CONFIGURAÇÕES Z-API ---');
    console.table(settings);
}

checkTodayMessages();
