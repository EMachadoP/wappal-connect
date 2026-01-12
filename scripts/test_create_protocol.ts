import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

async function testCreateProtocol() {
    console.log('=== TESTE DE CRIAÇÃO DE PROTOCOLO ===\n');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Get a recent conversation to test with
    const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .select('id, contact_id, active_condominium_id')
        .eq('status', 'open')
        .limit(1)
        .single();

    if (convErr || !conv) {
        console.log('❌ Nenhuma conversa encontrada:', convErr?.message);
        return;
    }

    console.log('📋 Conversa de teste:', conv);

    // Test calling the Edge Function directly
    console.log('\n📋 Chamando create-protocol...');

    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-protocol`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'apikey': SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                conversation_id: conv.id,
                summary: 'Teste de criação de protocolo via script',
                category: 'operational',
                priority: 'normal',
                notify_group: false,
            }),
        });

        const responseText = await response.text();
        console.log(`Status: ${response.status}`);
        console.log(`Response: ${responseText}`);

        if (!response.ok) {
            console.log('\n❌ Erro na criação do protocolo!');
        } else {
            const data = JSON.parse(responseText);
            if (data.already_existed) {
                console.log('\n⚠️ Protocolo já existia:', data.protocol_code);
            } else {
                console.log('\n✅ Protocolo criado:', data.protocol_code);
            }
        }
    } catch (e: any) {
        console.log('❌ Exceção:', e.message);
    }

    console.log('\n=== FIM ===');
}

testCreateProtocol().catch(console.error);
