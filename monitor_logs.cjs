require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://qoolzhzdcfnyblymdvbq.supabase.co',
    'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

console.log('🔍 Monitorando logs em tempo real...\n');
console.log('Aguardando atividade...\n');

let lastLogId = null;

async function monitorLogs() {
    const { data: logs } = await supabase
        .from('ai_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (!logs || logs.length === 0) return;

    const newestLog = logs[0];

    if (lastLogId !== newestLog.id) {
        lastLogId = newestLog.id;

        console.log('\n' + '='.repeat(80));
        console.log(`⏰ ${new Date(newestLog.created_at).toLocaleTimeString()}`);
        console.log(`📝 Status: ${newestLog.status}`);
        console.log(`🔧 Provider: ${newestLog.provider} / ${newestLog.model}`);

        if (newestLog.conversation_id) {
            console.log(`💬 Conversation: ${newestLog.conversation_id}`);
        }

        if (newestLog.error_message) {
            console.log(`❌ Erro: ${newestLog.error_message}`);
        }

        if (newestLog.output_text) {
            console.log(`✅ Resposta: ${newestLog.output_text.substring(0, 100)}...`);
        }

        if (newestLog.input_excerpt) {
            const excerpt = newestLog.input_excerpt.substring(0, 150);
            console.log(`📥 Input: ${excerpt}...`);
        }

        console.log('='.repeat(80));
    }
}

// Monitor a cada 2 segundos
setInterval(monitorLogs, 2000);

console.log('✅ Monitor iniciado. Pressione Ctrl+C para parar.\n');
console.log('📱 Agora envie sua mensagem pelo WhatsApp!\n');
