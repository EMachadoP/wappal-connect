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
    } catch {
      // ignore
    }
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

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Defina SUPABASE_URL/VITE_SUPABASE_URL e uma key (service role recomendado).');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const limit = Number(process.argv[2] || 25);
  const { data, error } = await supabase
    .from('ai_logs')
    .select('created_at,status,model,provider,conversation_id,error_message')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  if (!data || data.length === 0) {
    console.log('ai_logs: vazio');
    return;
  }

  for (const row of data) {
    const ts = row.created_at;
    const status = row.status;
    const model = row.model || '—';
    const provider = row.provider || '—';
    const cid = row.conversation_id ? String(row.conversation_id).slice(0, 8) : '—';
    const err = row.error_message ? String(row.error_message).slice(0, 140) : '';
    console.log(`${ts} | ${status} | ${provider}/${model} | conv=${cid}${err ? ` | ${err}` : ''}`);
  }
}

main().catch((e) => {
  console.error('Falha:', e?.message || e);
  process.exitCode = 1;
});
