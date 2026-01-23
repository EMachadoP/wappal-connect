import { createClient } from 'npm:@supabase/supabase-js@2.92.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log('🔍 Verificando mensagens recentes...\n');

// 1. Verificar se mensagem "Teste06" foi salva
console.log('1️⃣ Procurando mensagem "Teste06":');
const { data: teste06, error: err1 } = await supabase
    .from('messages')
    .select('id, sender_name, content, sent_at, created_at, provider_message_id, status')
    .ilike('content', '%Teste06%')
    .order('created_at', { ascending: false })
    .limit(5);

if (err1) {
    console.error('❌ Erro:', err1.message);
} else {
    console.log('✅ Encontrado:', teste06?.length || 0, 'mensagens');
    console.table(teste06);
}

// 2. Verificar message_outbox
console.log('\n2️⃣ Verificando message_outbox:');
const { data: outbox, error: err2 } = await supabase
    .from('message_outbox')
    .select('id, status, error, preview, sent_at, created_at')
    .ilike('preview', '%Teste06%')
    .order('created_at', { ascending: false })
    .limit(5);

if (err2) {
    console.error('❌ Erro:', err2.message);
} else {
    console.log('✅ Encontrado:', outbox?.length || 0, 'registros');
    console.table(outbox);
}

// 3. Verificar últimas mensagens da conversa (558197438430)
console.log('\n3️⃣ Últimas 10 mensagens da conversa:');
const { data: conv, error: err3 } = await supabase
    .from('conversations')
    .select('id, chat_id')
    .or('chat_id.ilike.%558197438430%,thread_key.ilike.%558197438430%')
    .maybeSingle();

if (err3 || !conv) {
    console.error('❌ Conversa não encontrada:', err3?.message);
} else {
    console.log('📝 Conversation ID:', conv.id);

    const { data: messages, error: err4 } = await supabase
        .from('messages')
        .select('id, sender_name, sender_type, content, sent_at, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(10);

    if (err4) {
        console.error('❌ Erro:', err4.message);
    } else {
        console.log('✅ Encontrado:', messages?.length || 0, 'mensagens');
        console.table(messages);
    }
}

// 4. Verificar logs de erro recentes (ai_logs)
console.log('\n4️⃣ Erros recentes em ai_logs:');
const { data: logs, error: err5 } = await supabase
    .from('ai_logs')
    .select('status, error_message, model, created_at')
    .eq('status', 'error')
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

if (err5) {
    console.error('❌ Erro:', err5.message);
} else {
    console.log('✅ Encontrado:', logs?.length || 0, 'erros');
    console.table(logs);
}

console.log('\n✅ Diagnóstico completo!');
