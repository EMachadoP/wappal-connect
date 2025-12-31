require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const supabaseServiceKey = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function updateIntegrations() {
    // Atualizar configurações de integração
    const { data, error } = await supabaseAdmin
        .from('integrations_settings')
        .update({
            whatsapp_group_id: '558197438430-1496317602',
            whatsapp_notifications_enabled: true,
            asana_enabled: true,
            asana_project_id: '1207998573284529',
            asana_section_operacional: null, // Será preenchido depois se necessário
            asana_section_financeiro: null,
        })
        .eq('id', (await supabaseAdmin.from('integrations_settings').select('id').single()).data.id);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('✅ Configurações atualizadas com sucesso!');
        console.log('WhatsApp Group ID:', '558197438430-1496317602');
        console.log('Asana Project ID:', '1207998573284529');
    }
}

updateIntegrations();
