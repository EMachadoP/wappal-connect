import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

async function checkColumns() {
    console.log('=== VERIFICANDO COLUNAS DA TABELA PROTOCOLS ===\n');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Get one protocol to see the actual columns
    const { data, error } = await supabase
        .from('protocols')
        .select('*')
        .limit(1)
        .single();

    if (error) {
        console.log('❌ Erro:', error.message);
        return;
    }

    console.log('Colunas disponíveis:');
    Object.keys(data).forEach(key => {
        console.log(`  - ${key}: ${typeof data[key]}`);
    });

    // Check if ai_classified exists
    console.log('\n📋 Verificação específica:');
    console.log(`  ai_classified existe? ${'ai_classified' in data ? '✅' : '❌'}`);
    console.log(`  ai_confidence existe? ${'ai_confidence' in data ? '✅' : '❌'}`);
    console.log(`  tags existe? ${'tags' in data ? '✅' : '❌'}`);
}

checkColumns().catch(console.error);
