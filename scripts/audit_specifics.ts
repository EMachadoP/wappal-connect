import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runAudit() {
    const { data: convs } = await supabase
        .from('conversations')
        .select('id, chat_id, thread_key, contact_id, last_message_at');

    if (!convs) return;

    for (const conv of convs) {
        const { data: contact } = await supabase
            .from('contacts')
            .select('name, is_group')
            .eq('id', conv.contact_id)
            .single();

        const name = contact?.name || 'Sem Nome';
        if (name.toLowerCase().includes('g7 serv') || name.toLowerCase().includes('portaria')) {
            const { count } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('conversation_id', conv.id);

            console.log(`Name: ${name}`);
            console.log(`  Group: ${contact?.is_group}`);
            console.log(`  ConvID: ${conv.id}`);
            console.log(`  ChatID: ${conv.chat_id}`);
            console.log(`  LastMsg: ${conv.last_message_at}`);
            console.log(`  MsgCount: ${count || 0}`);
            console.log('-------------------');
        }
    }
}

runAudit();
