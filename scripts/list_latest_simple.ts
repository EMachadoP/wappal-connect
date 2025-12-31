
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function listLatestSimple() {
    console.log('--- ÚLTIMOS 5 CONTATOS ---');
    const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, chat_lid, updated_at, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    contacts?.forEach(c => console.log(`ID: ${c.id} | Name: ${c.name} | ChatLid: ${c.chat_lid} | Updated: ${c.updated_at}`));

    console.log('\n--- ÚLTIMAS 5 CONVERSAS ---');
    const { data: convs } = await supabase
        .from('conversations')
        .select('id, chat_id, last_message_at, updated_at, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    convs?.forEach(cv => console.log(`ID: ${cv.id} | ChatID: ${cv.chat_id} | LastMsg: ${cv.last_message_at} | Updated: ${cv.updated_at}`));
}

listLatestSimple();
