import { createClient } from "npm:@supabase/supabase-js@2";
import { config } from "https://deno.land/x/dotenv/mod.ts";

const env = config();
const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runPrechecks() {
    console.log("🔍 [PRE-CHECK]");

    // 1. Count u:%
    const { count, error: countError } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .like("thread_key", "u:%");

    if (countError) {
        console.error("Error counting u:%:", countError);
    } else {
        console.log(`U_COUNT: ${count}`);
    }

    // 2. Eldon's Specific Check
    const { data: eldonData, error: eldonError } = await supabase
        .from("conversations")
        .select("id, thread_key, contact_id")
        .ilike("chat_id", "%558197438430%");

    if (eldonError) {
        console.error("Error checking Eldon's conversations:", eldonError);
    } else {
        console.log("\n🔍 Eldon's Conversations:");
        console.table(eldonData);
    }
}

runPrechecks();
