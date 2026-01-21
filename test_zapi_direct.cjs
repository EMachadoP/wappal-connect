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

  const instanceId = settings.zapi_instance_id;
  const token = settings.zapi_token;
  const clientToken = settings.zapi_security_token;

  const headers = { 'Content-Type': 'application/json' };
  if (clientToken) headers['Client-Token'] = clientToken;

  // Test phone number - try different formats
  const testPhone = '558197438430';  // O número que está no sistema
  const testMessage = `[TEST DIRETO ${new Date().toLocaleTimeString()}] Mensagem de teste enviada direto pelo script.`;

  console.log('=== TESTE ENVIO DIRETO ===');
  console.log(`Phone: ${testPhone}`);
  console.log(`Message: ${testMessage}`);
  console.log('');

  // Try sending with Z-API
  const body = {
    phone: testPhone,
    message: testMessage
  };

  console.log('Request body:', JSON.stringify(body, null, 2));
  console.log('');

  try {
    const resp = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const result = await resp.json();
    
    console.log(`HTTP Status: ${resp.status}`);
    console.log('Response:', JSON.stringify(result, null, 2));
    
    if (result.messageId || result.zapiMessageId) {
      console.log('\n✅ Z-API ACEITOU A MENSAGEM');
      console.log(`Message ID: ${result.messageId || result.zapiMessageId}`);
    } else {
      console.log('\n❌ Z-API NÃO RETORNOU MESSAGE ID');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main().catch(e => console.error(e.message));
