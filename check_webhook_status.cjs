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

loadEnvFromFiles(['.env', '.env.local', '.env.production', '.env.development']);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
let supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const extracted = tryExtractServiceRoleKeyFromRepo();
  if (extracted && (!supabaseKey || !String(supabaseKey).startsWith('sb_secret_'))) {
    supabaseKey = extracted;
  }
}

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Variáveis ausentes: defina SUPABASE_URL (ou VITE_SUPABASE_URL) e uma chave (SUPABASE_SERVICE_ROLE_KEY recomendado) em um .env/.env.production ou no ambiente.'
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('--- STATUS DO WEBHOOK (sem expor conteúdo) ---');

  const { data: settings, error: settingsErr } = await supabase
    .from('zapi_settings')
    .select('last_webhook_received_at, forward_webhook_url')
    .is('team_id', null)
    .maybeSingle();

  if (settingsErr) {
    console.error('Erro ao ler zapi_settings:', settingsErr.message);
  } else {
    console.log('last_webhook_received_at:', settings?.last_webhook_received_at ?? null);
    console.log('forward_webhook_url:', settings?.forward_webhook_url ?? null);
  }

  const { data: allSettings, error: allSettingsErr } = await supabase
    .from('zapi_settings')
    .select('team_id, last_webhook_received_at')
    .order('updated_at', { ascending: false })
    .limit(10);

  if (allSettingsErr) {
    console.error('Erro ao listar zapi_settings (team_id/last_webhook_received_at):', allSettingsErr.message);
  } else {
    console.log('zapi_settings (até 10):', allSettings || []);
  }

  const { count, error: countErr } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true });

  if (countErr) {
    console.error('Erro ao contar messages:', countErr.message);
  } else {
    console.log('messages (count):', count ?? 0);
  }

  const { data: lastMsg, error: lastMsgErr } = await supabase
    .from('messages')
    .select('sent_at, direction, provider')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (lastMsgErr) {
    console.error('Erro ao ler última message:', lastMsgErr.message);
  } else {
    console.log('última message:', lastMsg?.[0] ?? null);
  }

  const { data: lastInbound, error: lastInboundErr } = await supabase
    .from('messages')
    .select('sent_at, provider')
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (lastInboundErr) {
    console.error('Erro ao ler última inbound:', lastInboundErr.message);
  } else {
    console.log('última inbound:', lastInbound?.[0] ?? null);
  }
}

main().catch((e) => {
  console.error('Falha inesperada:', e?.message || e);
  process.exitCode = 1;
});
