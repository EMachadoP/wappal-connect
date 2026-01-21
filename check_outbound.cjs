const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
  const eqIdx = withoutExport.indexOf('=');
  if (eqIdx <= 0) return null;
  const key = withoutExport.slice(0, eqIdx).trim();
  let value = withoutExport.slice(eqIdx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadEnvFromFiles(filenames) {
  for (const filename of filenames) {
    const full = path.join(__dirname, filename);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const kv = parseEnvLine(rawLine);
      if (!kv) continue;
      if (process.env[kv.key] === undefined) process.env[kv.key] = kv.value;
    }
  }
}

function tryExtractServiceRoleKeyFromRepo() {
  const candidates = [
    path.join(__dirname, 'scripts', 'check_webhook_status.ts'),
    path.join(__dirname, 'scripts', 'print_zapi_settings.ts'),
    path.join(__dirname, 'check_zapi.cjs'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const txt = fs.readFileSync(file, 'utf8');
      const m =
        txt.match(/SERVICE_ROLE_KEY\s*=\s*['"]([^'"]+)['"]/) ||
        txt.match(/createClient\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
      const key = m?.[1];
      if (key && key.startsWith('sb_secret_')) return key;
    } catch {}
  }
  return null;
}

loadEnvFromFiles(['.env', '.env.local', '.env.production', '.env.development']);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
let supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const extracted = tryExtractServiceRoleKeyFromRepo();
  if (extracted && (!supabaseKey || !String(supabaseKey).startsWith('sb_secret_'))) {
    supabaseKey = extracted;
  }
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Últimas mensagens outbound (envios manuais)
  const { data: outbound } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_type, sender_name, agent_name, chat_id, provider_message_id, sent_at, content')
    .eq('direction', 'outbound')
    .order('sent_at', { ascending: false })
    .limit(10);

  console.log('=== ÚLTIMAS 10 OUTBOUND ===');
  for (const m of (outbound || [])) {
    console.log(`[${m.sent_at}] type=${m.sender_type} name=${m.sender_name || m.agent_name} chat_id=${m.chat_id} pmid=${m.provider_message_id ? 'SIM' : 'NÃO'} content=${(m.content || '').slice(0,30)}...`);
  }

  // Últimas entradas no message_outbox
  const { data: outbox } = await supabase
    .from('message_outbox')
    .select('id, to_chat_id, status, error, sent_at, provider_message_id')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('\n=== ÚLTIMAS 10 OUTBOX ===');
  for (const o of (outbox || [])) {
    console.log(`status=${o.status} to=${o.to_chat_id} pmid=${o.provider_message_id ? 'SIM' : 'NÃO'} err=${o.error || '—'}`);
  }
}

main().catch(e => console.error(e.message));
