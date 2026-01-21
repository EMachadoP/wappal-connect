const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qoolzhzdcfnyblymdvbq.supabase.co',
  'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

// Reproduz a função stableKey do zapi-send-message
const stableKey = (obj) => {
  const s = JSON.stringify(obj, Object.keys(obj).sort());
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `auto_${h.toString(16)}`;
};

async function main() {
  // Simula as chaves que seriam geradas para "Teste08", "Teste10", etc.
  const testMessages = ['Teste08', 'Teste10', 'Teste12', 'Teste14', 'TesteUnico123'];
  
  console.log('=== SIMULAÇÃO DE IDEMPOTENCY KEYS ===\n');
  
  for (const content of testMessages) {
    const key = stableKey({
      conversation_id: '123', // exemplo
      chatId: '558197438430',
      content: content,
      message_type: 'text',
      media_url: null,
      senderName: 'Ana Mônica',
    });
    console.log(`"${content}" -> ${key}`);
  }
  
  // Verifica se há chaves duplicadas no outbox
  console.log('\n=== OUTBOX - ÚLTIMAS 20 ENTRADAS ===\n');
  
  const { data: outbox, error } = await supabase
    .from('message_outbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  
  if (error) {
    console.log('Error:', error.message);
  }
  
  for (const o of (outbox || [])) {
    console.log(`[${o.created_at}] ${o.status} | key=${o.idempotency_key?.slice(0, 20) || 'NULL'}... | to=${o.to_chat_id}`);
  }
}

main().catch(e => console.error(e.message));
