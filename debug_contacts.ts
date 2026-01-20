
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!url || !key) {
    console.error("Missing env vars");
    Deno.exit(1);
}

const sb = createClient(url, key);

const { data, error } = await sb
    .from('contacts')
    .select('*')
    .or("chat_lid.eq.144723385778292@lid,phone.eq.558197438430");

if (error) {
    console.error(error);
} else {
    console.log(JSON.stringify(data, null, 2));
}
