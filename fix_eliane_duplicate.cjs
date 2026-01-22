const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qoolzhzdcfnyblymdvbq.supabase.co',
  'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function main() {
  console.log('=== DIAGNÓSTICO: Eliane Duplicada ===\n');

  // 1. Buscar contatos com nome Eliane
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .ilike('name', '%Eliane%');

  console.log('CONTATOS com nome Eliane:');
  for (const c of (contacts || [])) {
    console.log(`  id=${c.id?.slice(0,8)}...`);
    console.log(`    name: ${c.name}`);
    console.log(`    phone: ${c.phone}`);
    console.log(`    jid: ${c.jid}`);
    console.log(`    wa_id: ${c.wa_id}`);
    console.log('');
  }

  // 2. Buscar conversas relacionadas
  const contactIds = (contacts || []).map(c => c.id);
  
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, chat_id, thread_key, status, contact_id, last_message_at')
    .in('contact_id', contactIds);

  console.log('CONVERSAS da Eliane:');
  for (const conv of (convs || [])) {
    console.log(`  conv_id=${conv.id?.slice(0,8)}...`);
    console.log(`    chat_id: ${conv.chat_id}`);
    console.log(`    thread_key: ${conv.thread_key}`);
    console.log(`    contact_id: ${conv.contact_id?.slice(0,8)}...`);
    console.log(`    last_message_at: ${conv.last_message_at}`);
    console.log('');
  }

  // 3. Buscar por chat_id com número da Eliane
  const searchTerms = ['558188981175', '183073132036139'];
  
  console.log('CONVERSAS por chat_id/thread_key:');
  for (const term of searchTerms) {
    const { data: byChat } = await supabase
      .from('conversations')
      .select('id, chat_id, thread_key, contact_id, status')
      .or(`chat_id.ilike.%${term}%,thread_key.ilike.%${term}%`);
    
    for (const c of (byChat || [])) {
      console.log(`  [${term}] conv=${c.id?.slice(0,8)}... chat_id=${c.chat_id} thread=${c.thread_key}`);
    }
  }

  // 4. Identificar qual manter (a com phone real)
  console.log('\n=== AÇÃO RECOMENDADA ===');
  const phoneConv = (convs || []).find(c => c.chat_id?.includes('558188981175'));
  const lidConv = (convs || []).find(c => c.chat_id?.includes('@lid') || c.thread_key?.includes('183073'));
  
  if (phoneConv && lidConv && phoneConv.id !== lidConv.id) {
    console.log('ENCONTRADAS 2 CONVERSAS DIFERENTES:');
    console.log(`  ✓ MANTER (phone): ${phoneConv.id}`);
    console.log(`  ✗ MESCLAR (lid): ${lidConv.id}`);
    console.log('\nPara mesclar, execute:');
    console.log('  node fix_eliane_duplicate.cjs --merge');
  } else {
    console.log('Não encontrei duplicatas claras para mesclar automaticamente.');
  }

  // Se passou --merge, faz o merge
  if (process.argv.includes('--merge') && phoneConv && lidConv && phoneConv.id !== lidConv.id) {
    console.log('\n=== EXECUTANDO MERGE ===');
    
    // 1. Mover mensagens
    const { error: msgErr, count: msgCount } = await supabase
      .from('messages')
      .update({ conversation_id: phoneConv.id })
      .eq('conversation_id', lidConv.id);
    
    console.log(`Mensagens movidas: ${msgErr ? 'ERRO: ' + msgErr.message : 'OK'}`);

    // 2. Mover protocolos
    await supabase
      .from('protocols')
      .update({ conversation_id: phoneConv.id })
      .eq('conversation_id', lidConv.id);
    console.log('Protocolos movidos: OK');

    // 3. Deletar conversa duplicada
    const { error: delErr } = await supabase
      .from('conversations')
      .delete()
      .eq('id', lidConv.id);
    
    console.log(`Conversa LID deletada: ${delErr ? 'ERRO: ' + delErr.message : 'OK'}`);
    
    console.log('\n✓ Merge concluído!');
  }
}

main().catch(e => console.error(e.message));
