import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runAudit() {
    const { data: contacts } = await supabase.from('contacts').select('id, name, is_group');
    if (!contacts) return;

    const nameMap = new Map();
    contacts.forEach(c => {
        const n = c.name?.trim().toLowerCase();
        if (!n) return;
        if (!nameMap.has(n)) nameMap.set(n, []);
        nameMap.get(n).push(c);
    });

    const sortedNames = Array.from(nameMap.keys()).sort();
    for (const name of sortedNames) {
        const list = nameMap.get(name);
        if (list.length > 1) {
            console.log(`Duplicate Name Found: "${name}"`);
            for (const contact of list) {
                const { data: convs } = await supabase
                    .from('conversations')
                    .select('id, chat_id, thread_key, last_message_at')
                    .eq('contact_id', contact.id);

                if (convs && convs.length > 0) {
                    for (const conv of convs) {
                        const { count } = await supabase
                            .from('messages')
                            .select('*', { count: 'exact', head: true })
                            .eq('conversation_id', conv.id);

                        console.log(`  - ConvID: ${conv.id}`);
                        console.log(`    ChatID: ${conv.chat_id}`);
                        console.log(`    Msgs: ${count || 0}${contact.is_group ? ' (Group)' : ''}`);
                        console.log(`    Last: ${conv.last_message_at}`);
                    }
                } else {
                    console.log(`  - Contact: ${contact.id} (No Conversation)`);
                }
            }
        }
    }
}

runAudit();
