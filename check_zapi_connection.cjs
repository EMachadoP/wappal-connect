const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qoolzhzdcfnyblymdvbq.supabase.co',
  'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function main() {
  // Get Z-API settings
  const { data: settings } = await supabase
    .from('zapi_settings')
    .select('*')
    .limit(1)
    .single();

  if (!settings) {
    console.log('No Z-API settings found');
    return;
  }

  const instanceId = settings.zapi_instance_id;
  const token = settings.zapi_token;
  const clientToken = settings.zapi_security_token;

  console.log('=== Z-API CONFIG ===');
  console.log(`Instance: ${instanceId}`);
  console.log(`Token: ${token?.slice(0, 15)}...`);
  console.log(`Client Token: ${clientToken ? 'SET' : 'NOT SET'}`);

  // Test Z-API connection - get connected phone
  const headers = { 'Content-Type': 'application/json' };
  if (clientToken) headers['Client-Token'] = clientToken;

  try {
    // Get device info
    const deviceResp = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/device`, {
      method: 'GET',
      headers
    });
    const device = await deviceResp.json();
    console.log('\n=== CONNECTED DEVICE ===');
    console.log(JSON.stringify(device, null, 2));

    // Get queue status
    const queueResp = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/queue`, {
      method: 'GET',
      headers
    });
    const queue = await queueResp.json();
    console.log('\n=== QUEUE STATUS ===');
    console.log(JSON.stringify(queue, null, 2));

    // Check status
    const statusResp = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/status`, {
      method: 'GET',
      headers
    });
    const status = await statusResp.json();
    console.log('\n=== CONNECTION STATUS ===');
    console.log(JSON.stringify(status, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  }
}

main().catch(e => console.error(e.message));
