

const WEBHOOK_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/zapi-webhook';

async function testWebhook() {
    const payload = {
        messageId: "SIMULATED-RECOVERY-" + Date.now(),
        chatLid: "144723385778292@lid",
        phone: "558197438430",
        chatName: "Eldon Machado",
        senderName: "Eldon Machado",
        text: {
            message: "Simulando Recuperação do Teste04"
        },
        fromMe: false,
        isGroup: false,
        type: "ReceivedCallback",
        status: "RECEIVED"
    };

    console.log('Enviando payload para:', WEBHOOK_URL);

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log('Status:', response.status);
        console.log('Resposta:', JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('Erro na requisição:', err.message);
    }
}

testWebhook();
