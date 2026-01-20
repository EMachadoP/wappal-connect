
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const supabaseKey = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";
const supabase = createClient(supabaseUrl, supabaseKey);

const phone = "558197438430";
const lid = "144723385778292@lid";

async function diagnose() {
    const report = {};
    try {
        // 1. Contacts
        const { data: contacts, error: contactErr } = await supabase
            .from('contacts')
            .select('*, participants(*)')
            .or(`phone.eq.${phone},chat_lid.eq.${lid},chat_key.eq.u:${phone},chat_key.eq.u:${lid.split('@')[0]}`);

        report.contacts = contacts;
        report.contactError = contactErr;

        if (contacts && contacts.length > 0) {
            const contactIds = contacts.map(c => c.id);

            // 2. Conversations
            const { data: conversations, error: convErr } = await supabase
                .from('conversations')
                .select('*')
                .in('contact_id', contactIds);

            report.conversations = conversations;
            report.convError = convErr;

            if (conversations && conversations.length > 0) {
                const convIds = conversations.map(c => c.id);

                // 3. Messages
                const { data: messages, error: msgErr } = await supabase
                    .from('messages')
                    .select('id, conversation_id, content, sender_name, sender_type, direction, created_at')
                    .in('conversation_id', convIds)
                    .order('created_at', { ascending: false })
                    .limit(50);

                report.messages = messages;
                report.msgError = msgErr;
            }
        }

        // 4. AI Logs
        const { data: aiLogs } = await supabase
            .from('ai_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        report.aiLogs = aiLogs;

        fs.writeFileSync('c:\\Projetos\\wappal-connect\\diagnose_full_report.json', JSON.stringify(report, null, 2));
        console.log("Report saved to diagnose_full_report.json");
    } catch (e) {
        console.error("Diagnostic failed:", e);
    }
}

diagnose();
