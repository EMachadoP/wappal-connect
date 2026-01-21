const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qoolzhzdcfnyblymdvbq.supabase.co',
  'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function main() {
  // Find Teste06 messages
  const { data: msgs, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_type, sender_name, chat_id, provider_message_id, sent_at, content, direction')
    .ilike('content', '%Teste0%')
    .order('sent_at', { ascending: false })
    .limit(20);
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  console.log('=== MENSAGENS TESTE ===');
  for (const m of (msgs || [])) {
    console.log(`[${m.sent_at}] ${m.direction} ${m.sender_type} name="${m.sender_name}" chat_id=${m.chat_id} pmid=${m.provider_message_id ? 'SIM' : 'NÃO'} "${m.content}"`);
  }
  
  // Also check outbox
  const { data: outbox } = await supabase
    .from('message_outbox')
    .select('id, to_chat_id, status, error, sent_at, provider_message_id, content, idempotency_key')
    .ilike('content', '%Teste0%')
    .order('created_at', { ascending: false })
    .limit(20);
  
  console.log('\n=== OUTBOX TESTE ===');
  for (const o of (outbox || [])) {
    console.log(`status=${o.status} to=${o.to_chat_id} pmid=${o.provider_message_id ? o.provider_message_id.slice(0,15)+'...' : 'NÃO'} err=${o.error || '—'} "${o.content}"`);
  }
}

main().catch(e => console.error(e.message));
