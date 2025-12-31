
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkRecentActivity() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    console.log(`--- CONTATOS ATUALIZADOS HOJE ---`);
    const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, chat_lid, updated_at')
        .gte('updated_at', todayStr)
        .order('updated_at', { ascending: false });
    console.table(contacts);

    console.log(`\n--- CONVERSAS ATUALIZADAS HOJE ---`);
    const { data: convs } = await supabase
        .from('conversations')
        .select('id, chat_id, last_message_at, status')
        .gte('last_message_at', todayStr)
        .order('last_message_at', { ascending: false });
    console.table(convs);
}

checkRecentActivity();
