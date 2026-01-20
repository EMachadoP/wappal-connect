
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const supabaseUrl = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const supabaseKey = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";
const supabase = createClient(supabaseUrl, supabaseKey);

const phone = "558197438430";
const lid = "144723385778292@lid";

async function diagnose() {
    console.log("--- DIAGNOSING CONTACTS ---");
    const { data: contacts } = await supabase
        .from('contacts')
        .select('*, participants(*)')
        .or(`phone.eq.${phone},chat_lid.eq.${lid},chat_id.eq.${phone}@s.whatsapp.net,chat_id.eq.${lid}`);

    console.log("Contacts found:", JSON.stringify(contacts, null, 2));

    if (contacts && contacts.length > 0) {
        const contactIds = contacts.map(c => c.id);

        console.log("\n--- DIAGNOSING CONVERSATIONS ---");
        const { data: conversations } = await supabase
            .from('conversations')
            .select('*')
            .in('contact_id', contactIds);

        console.log("Conversations found:", JSON.stringify(conversations, null, 2));

        if (conversations && conversations.length > 0) {
            const convIds = conversations.map(c => c.id);

            console.log("\n--- LATEST MESSAGES ---");
            const { data: messages } = await supabase
                .from('messages')
                .select('id, conversation_id, content, sender_name, sender_type, direction, created_at')
                .in('conversation_id', convIds)
                .order('created_at', { ascending: false })
                .limit(10);

            console.log("Latest messages:", JSON.stringify(messages, null, 2));
        }
    }

    console.log("\n--- AI LOGS (WEBHOOK DEBUG) ---");
    const { data: aiLogs } = await supabase
        .from('ai_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    console.log("Latest AI Logs:", JSON.stringify(aiLogs, null, 2));
}

diagnose();
