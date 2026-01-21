const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qoolzhzdcfnyblymdvbq.supabase.co',
  'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function main() {
  const targetPhone = '558197438430';
  
  // Check outbox for sends to this number
  const { data: outbox } = await supabase
    .from('message_outbox')
    .select('*')
    .or(`to_chat_id.ilike.%${targetPhone}%,recipient.ilike.%${targetPhone}%`)
    .order('created_at', { ascending: false })
    .limit(10);
  
  console.log(`=== OUTBOX para ${targetPhone} ===\n`);
  
  if (!outbox || outbox.length === 0) {
    console.log('❌ NENHUM REGISTRO NO OUTBOX!');
    console.log('Isso significa que as mensagens NÃO estão passando pelo zapi-send-message corretamente.');
    return;
  }
  
  for (const o of outbox) {
    console.log(`[${o.created_at}]`);
    console.log(`  status: ${o.status}`);
    console.log(`  to_chat_id: ${o.to_chat_id}`);
    console.log(`  recipient: ${o.recipient}`);
    console.log(`  provider_message_id: ${o.provider_message_id || 'NULL'}`);
    console.log(`  error: ${o.error || '—'}`);
    console.log(`  content: "${(o.content || '').slice(0, 80)}..."`);
    console.log('');
  }
}

main().catch(e => console.error(e.message));
