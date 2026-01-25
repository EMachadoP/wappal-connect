import { createClient } from 'npm:@supabase/supabase-js@2';

// Load .env manually
const envText = await Deno.readTextFile('.env');
const envVars: Record<string, string> = {};
for (const line of envText.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        envVars[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
}

const supabaseUrl = envVars['SUPABASE_URL'] || Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = envVars['SUPABASE_SERVICE_ROLE_KEY'] || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log('🔍 Diagnosing G7 Serv / Group Duplicates...');

const { data, error } = await supabase
    .from('conversations')
    .select('id, chat_id, thread_key, contact_name, created_at, status, pending_payload')
    .or('contact_name.ilike.%G7%,contact_name.ilike.%Serv%,chat_id.ilike.%g.us%,thread_key.ilike.%group:%')
    .order('created_at', { ascending: false })
    .limit(20);

if (error) {
    console.error('❌ Error:', error);
} else {
    console.table(data.map(c => ({
        id: c.id,
        chat_id: c.chat_id,
        thread_key: c.thread_key,
        contact_name: c.contact_name,
        created_at: c.created_at,
        status: c.status,
        chat_name_payload: (c.pending_payload as any)?.chatName,
        is_group_payload: (c.pending_payload as any)?.isGroup
    })));
}
