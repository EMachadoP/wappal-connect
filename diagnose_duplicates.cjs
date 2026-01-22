const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qoolzhzdcfnyblymdvbq.supabase.co',
  'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function main() {
  console.log('=== DIAGNÓSTICO DE DUPLICAÇÕES E MENSAGENS FALTANDO ===\n');

  // 1. Check for duplicate contacts (same phone, different records)
  console.log('1. CONTATOS DUPLICADOS (mesmo telefone):');
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, phone, jid, wa_id, created_at')
    .order('phone');
  
  const phoneCount = {};
  for (const c of (contacts || [])) {
    const phone = c.phone || c.jid || c.wa_id || 'unknown';
    if (!phoneCount[phone]) phoneCount[phone] = [];
    phoneCount[phone].push(c);
  }
  
  let duplicateContactsFound = 0;
  for (const [phone, entries] of Object.entries(phoneCount)) {
    if (entries.length > 1) {
      duplicateContactsFound++;
      console.log(`  📱 ${phone} - ${entries.length} registros:`);
      for (const e of entries) {
        console.log(`     id=${e.id?.slice(0,8)}... name="${e.name}" created=${e.created_at}`);
      }
    }
  }
  if (duplicateContactsFound === 0) {
    console.log('  ✅ Nenhum contato duplicado encontrado');
  }

  // 2. Check for duplicate conversations (same thread_key or chat_id)
  console.log('\n2. CONVERSAS DUPLICADAS (mesmo thread_key ou chat_id):');
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, thread_key, chat_id, status, contact_id, created_at')
    .order('thread_key');
  
  const threadCount = {};
  for (const c of (convs || [])) {
    const key = c.thread_key || c.chat_id || 'unknown';
    if (!threadCount[key]) threadCount[key] = [];
    threadCount[key].push(c);
  }
  
  let duplicateConvsFound = 0;
  for (const [key, entries] of Object.entries(threadCount)) {
    if (entries.length > 1) {
      duplicateConvsFound++;
      console.log(`  🔑 ${key} - ${entries.length} conversas:`);
      for (const e of entries) {
        console.log(`     id=${e.id?.slice(0,8)}... status=${e.status} contact=${e.contact_id?.slice(0,8) || 'null'}`);
      }
    }
  }
  if (duplicateConvsFound === 0) {
    console.log('  ✅ Nenhuma conversa duplicada encontrada');
  }

  // 3. Check for messages with duplicate provider_message_id
  console.log('\n3. MENSAGENS DUPLICADAS (mesmo provider_message_id):');
  const { data: msgs } = await supabase
    .from('messages')
    .select('id, provider_message_id, conversation_id, direction, sent_at')
    .not('provider_message_id', 'is', null)
    .order('provider_message_id');
  
  const msgIdCount = {};
  for (const m of (msgs || [])) {
    const pmid = m.provider_message_id;
    if (!pmid) continue;
    if (!msgIdCount[pmid]) msgIdCount[pmid] = [];
    msgIdCount[pmid].push(m);
  }
  
  let duplicateMsgsFound = 0;
  for (const [pmid, entries] of Object.entries(msgIdCount)) {
    if (entries.length > 1) {
      duplicateMsgsFound++;
      if (duplicateMsgsFound <= 5) { // Limit output
        console.log(`  📩 ${pmid.slice(0,15)}... - ${entries.length} mensagens`);
      }
    }
  }
  console.log(`  Total: ${duplicateMsgsFound} provider_message_ids duplicados`);

  // 4. Recent messages that might be missing from App (check webhooks received)
  console.log('\n4. ÚLTIMAS MENSAGENS INBOUND (devem aparecer no App):');
  const { data: recentInbound } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_name, content, sent_at, direction, provider_message_id')
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(10);
  
  for (const m of (recentInbound || [])) {
    console.log(`  [${m.sent_at}] conv=${m.conversation_id?.slice(0,8)}... from="${m.sender_name}" pmid=${m.provider_message_id ? 'SIM' : 'NÃO'}`);
    console.log(`    content: "${(m.content || '').slice(0, 50)}..."`);
  }

  // 5. Check webhook reception
  console.log('\n5. WEBHOOKS RECEBIDOS (últimas 24h):');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: webhookLogs, count } = await supabase
    .from('ai_logs')
    .select('*', { count: 'exact' })
    .gte('created_at', yesterday)
    .ilike('source', '%webhook%')
    .order('created_at', { ascending: false })
    .limit(5);
  
  console.log(`  Total de webhooks: ${count || 0}`);
  for (const log of (webhookLogs || [])) {
    console.log(`  [${log.created_at}] ${log.source}`);
  }
}

main().catch(e => console.error(e.message));
