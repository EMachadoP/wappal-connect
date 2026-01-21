const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qoolzhzdcfnyblymdvbq.supabase.co',
  'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function main() {
  // Find conversations with phone 558197438430
  const targetPhone = '558197438430';
  
  console.log(`=== BUSCANDO CONVERSAS COM ${targetPhone} ===\n`);
  
  // 1. Check contacts table
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, phone, jid, wa_id')
    .or(`phone.ilike.%${targetPhone}%,jid.ilike.%${targetPhone}%,wa_id.ilike.%${targetPhone}%`);
  
  console.log('CONTACTS encontrados:');
  for (const c of (contacts || [])) {
    console.log(`  id=${c.id?.slice(0,8)}... name="${c.name}" phone=${c.phone} jid=${c.jid}`);
  }
  
  // 2. Check conversations with this chat_id
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, chat_id, thread_key, status, contact_id, contacts(name, phone, jid)')
    .or(`chat_id.ilike.%${targetPhone}%,thread_key.ilike.%${targetPhone}%`);
  
  console.log('\nCONVERSATIONS encontradas:');
  for (const c of (convs || [])) {
    const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
    console.log(`  conv_id=${c.id?.slice(0,8)}...`);
    console.log(`    chat_id: ${c.chat_id}`);
    console.log(`    thread_key: ${c.thread_key}`);
    console.log(`    status: ${c.status}`);
    console.log(`    contact: ${contact?.name} (${contact?.phone})`);
    console.log('');
  }
  
  // 3. Check recent messages to/from this number
  const { data: msgs } = await supabase
    .from('messages')
    .select('id, conversation_id, direction, sender_type, chat_id, sent_at, content')
    .ilike('chat_id', `%${targetPhone}%`)
    .order('sent_at', { ascending: false })
    .limit(5);
  
  console.log('ÚLTIMAS MENSAGENS com este chat_id:');
  for (const m of (msgs || [])) {
    console.log(`  [${m.sent_at}] ${m.direction} ${m.sender_type} chat_id=${m.chat_id}`);
    console.log(`    content: "${(m.content || '').slice(0, 40)}..."`);
  }
}

main().catch(e => console.error(e.message));
