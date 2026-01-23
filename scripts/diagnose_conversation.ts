
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseServiceKey = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'; // Temporary for diagnostic
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const TARGET_ID = "86852979679326";

async function diagnose() {
    console.log(`🔍 Diagnosing conversation for ID fragment: ${TARGET_ID}`);

    // 1. Find conversations matching this ID
    const { data: convs, error: convError } = await supabase
        .from("conversations")
        .select("id, thread_key, chat_id, is_group, title, contact_id, updated_at")
        .or(`thread_key.ilike.%${TARGET_ID}%,chat_id.ilike.%${TARGET_ID}%`)
        .limit(20);

    if (convError) {
        console.error("❌ Error fetching conversations:", convError);
        return;
    }

    console.log(`\n📄 Found ${convs.length} conversations:`);

    if (convs.length === 0) {
        console.log("No conversations found. This implies data is missing or key format is vastly different.");
        return;
    }

    for (const conv of convs) {
        const { count, error: msgError } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("conversation_id", conv.id);

        console.log(`\n--------------------------------------------------`);
        console.log(`🆔 ID: ${conv.id}`);
        console.log(`🔑 Thread Key: ${conv.thread_key}`);
        console.log(`📱 Chat ID: ${conv.chat_id}`);
        console.log(`👥 Is Group: ${conv.is_group}`);
        console.log(`🏷️ Title: "${conv.title}"`);
        console.log(`👤 Contact ID: ${conv.contact_id}`);
        console.log(`📅 Updated: ${conv.updated_at}`);
        console.log(`💬 Message Count: ${count} ${msgError ? `(Error: ${msgError.message})` : ""}`);
        console.log(`--------------------------------------------------`);
    }
}

diagnose();
