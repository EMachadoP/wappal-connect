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

function inc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function safeParse(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

async function main() {
  const limit = Number(process.argv[2] || 200);
  const { data, error } = await supabase
    .from('ai_logs')
    .select('created_at,input_excerpt,status')
    .eq('status', 'webhook_received')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const byType = new Map();
  const byEvent = new Map();
  const byStatus = new Map();
  const byDirection = new Map();
  let parsedOk = 0;
  let hasContent = 0;
  let statusUpdates = 0;

  for (const row of data || []) {
    const p = typeof row.input_excerpt === 'string' ? safeParse(row.input_excerpt) : null;
    if (!p) continue;
    parsedOk++;

    inc(byType, String(p.type || '—'));
    inc(byEvent, String(p.event || '—'));
    inc(byStatus, String((p.status || '—')).toLowerCase());
    inc(byDirection, String(p.direction || '—'));

    const statusLower = String(p.status || '').toLowerCase();
    const isStatusUpdate =
      p.event === 'message-status-update' ||
      p.type === 'message-status-update' ||
      (p.status && p.messageId && statusLower !== 'received');
    if (isStatusUpdate) statusUpdates++;

    const content =
      p?.text?.message ||
      p?.message?.text ||
      p?.body ||
      p?.caption ||
      p?.image ||
      p?.video ||
      p?.audio ||
      p?.document;
    if (content) hasContent++;
  }

  function top(map, n = 8) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  console.log(`webhook_received analisados: ${data?.length || 0}`);
  console.log(`JSON parse OK: ${parsedOk}`);
  console.log(`com conteúdo (texto/mídia): ${hasContent}`);
  console.log(`status updates detectados: ${statusUpdates}`);
  console.log('Top type:', top(byType));
  console.log('Top event:', top(byEvent));
  console.log('Top status:', top(byStatus));
  console.log('Top direction:', top(byDirection));
  console.log('Mais recente:', data?.[0]?.created_at || null);
  console.log('Mais antigo (janela):', data?.[data.length - 1]?.created_at || null);
}

main().catch((e) => {
  console.error('Falha:', e?.message || e);
  process.exitCode = 1;
});
