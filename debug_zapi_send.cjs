const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qoolzhzdcfnyblymdvbq.supabase.co',
  'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function main() {
  // 1. Check ai_logs for zapi-send-message calls
  const { data: sendLogs, error: logsErr } = await supabase
    .from('ai_logs')
    .select('*')
    .or('event_type.ilike.%send%,source.ilike.%send%')
    .order('created_at', { ascending: false })
    .limit(15);

  console.log('=== AI_LOGS (send-related) ===');
  if (logsErr) {
    console.error('Error:', logsErr.message);
  } else {
    for (const log of (sendLogs || [])) {
      console.log(`[${log.created_at}] ${log.event_type} | ${log.source}`);
      if (log.details) {
        const d = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
        console.log('  Details:', JSON.stringify(d, null, 2).slice(0, 500));
      }
    }
  }

  // 2. Check message_outbox for recent sends
  console.log('\n=== MESSAGE_OUTBOX (últimos 10) ===');
  const { data: outbox } = await supabase
    .from('message_outbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  for (const o of (outbox || [])) {
    console.log(`[${o.created_at}] status=${o.status}`);
    console.log(`  to_chat_id: ${o.to_chat_id}`);
    console.log(`  recipient: ${o.recipient}`);
    console.log(`  provider_message_id: ${o.provider_message_id || 'NULL'}`);
    console.log(`  error: ${o.error || '—'}`);
    console.log(`  content: "${(o.content || '').slice(0, 50)}..."`);
    console.log('');
  }

  // 3. Check zapi_settings
  console.log('\n=== ZAPI_SETTINGS ===');
  const { data: settings } = await supabase
    .from('zapi_settings')
    .select('zapi_instance_id, zapi_token, zapi_security_token, last_webhook_received_at')
    .limit(1)
    .single();

  if (settings) {
    console.log(`Instance ID: ${settings.zapi_instance_id}`);
    console.log(`Token: ${settings.zapi_token ? settings.zapi_token.slice(0, 10) + '...' : 'NULL'}`);
    console.log(`Security Token: ${settings.zapi_security_token ? 'SET' : 'NULL'}`);
    console.log(`Last Webhook: ${settings.last_webhook_received_at}`);
  }
}

main().catch(e => console.error(e.message));
