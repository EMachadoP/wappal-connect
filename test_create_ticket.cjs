require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseServiceKey = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testCreateTicket() {
    console.log('🧪 Testando criação de ticket...\n');

    // Buscar uma conversa existente para teste
    const { data: conv } = await supabase
        .from('conversations')
        .select('id, contact_id')
        .limit(1)
        .single();

    if (!conv) {
        console.error('❌ Nenhuma conversa encontrada para teste');
        return;
    }

    const ticketData = {
        conversation_id: conv.id,
        contact_id: conv.contact_id,
        summary: 'Teste de criação de protocolo automático - Portão não abre',
        priority: 'normal',
        category: 'operational',
        requester_name: 'João da Portaria',
        requester_role: 'Porteiro',
    };

    console.log('📋 Dados do ticket:', JSON.stringify(ticketData, null, 2));

    const { data, error } = await supabase.functions.invoke('create-ticket', {
        body: ticketData
    });

    if (error) {
        console.error('\n❌ Erro:', error);
    } else {
        console.log('\n✅ Ticket criado com sucesso!');
        console.log('📝 Protocolo:', data.protocol_code);
        console.log('📱 WhatsApp enviado:', data.whatsapp_sent ? 'Sim' : 'Não');
        console.log('📊 Asana criado:', data.asana_created ? 'Sim' : 'Não');
    }
}

testCreateTicket();
