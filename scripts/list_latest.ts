
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function listLatest() {
    console.log('--- ÚLTIMOS 10 CONTATOS ---');
    const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, chat_lid, updated_at, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
    console.table(contacts);

    console.log('\n--- ÚLTIMAS 10 CONVERSAS ---');
    const { data: convs } = await supabase
        .from('conversations')
        .select('id, chat_id, last_message_at, updated_at, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
    console.table(convs);
}

listLatest();
