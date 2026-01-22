// Teste de UPSERT - Simula 5 webhooks simultâneos para o mesmo chat_id
// Execute com: npx ts-node test-concurrent-webhook.ts

const SUPABASE_URL = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/zapi-webhook`;

// Gerar um chat_id único para este teste
const TEST_PHONE = `5581999${Date.now().toString().slice(-6)}`;
const TEST_CHAT_ID = `${TEST_PHONE}@s.whatsapp.net`;

console.log(`\n🧪 TESTE DE UPSERT ATÔMICO`);
console.log(`📱 Chat ID de teste: ${TEST_CHAT_ID}`);
console.log(`⏱️  Enviando 5 webhooks SIMULTÂNEOS...\n`);

const createPayload = (index: number) => ({
    event: "message",
    isGroup: false,
    chatId: TEST_CHAT_ID,
    phone: TEST_PHONE,
    senderName: `Teste Concorrência ${index}`,
    text: { message: `Mensagem de teste #${index} - ${new Date().toISOString()}` },
    messageId: `test_msg_${Date.now()}_${index}`,
    timestamp: Date.now(),
    fromMe: false,
});

async function sendWebhook(index: number): Promise<{ index: number; status: number; body: string }> {
    const start = Date.now();
    try {
        const res = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(createPayload(index)),
        });
        const body = await res.text();
        console.log(`  [${index}] ${res.status} em ${Date.now() - start}ms`);
        return { index, status: res.status, body };
    } catch (e: any) {
        console.log(`  [${index}] ERRO: ${e.message}`);
        return { index, status: 0, body: e.message };
    }
}

async function runTest() {
    // Enviar 5 requests simultâneos
    const promises = [1, 2, 3, 4, 5].map((i) => sendWebhook(i));
    const results = await Promise.all(promises);

    console.log(`\n📊 RESULTADOS:`);
    const success = results.filter((r) => r.status === 200).length;
    const failed = results.filter((r) => r.status !== 200).length;
    console.log(`  ✅ Sucesso: ${success}`);
    console.log(`  ❌ Falha: ${failed}`);

    console.log(`\n🔍 Agora verifique no Supabase Dashboard:`);
    console.log(`
-- Deve retornar EXATAMENTE 1 contact:
SELECT * FROM contacts WHERE phone LIKE '%${TEST_PHONE.slice(-8)}%';

-- Deve retornar EXATAMENTE 1 conversation:
SELECT * FROM conversations WHERE thread_key LIKE '%${TEST_PHONE}%';

-- Deve retornar 5 mensagens (uma de cada webhook):
SELECT * FROM messages WHERE chat_id = '${TEST_CHAT_ID}' ORDER BY sent_at DESC;
`);
}

runTest().catch(console.error);
