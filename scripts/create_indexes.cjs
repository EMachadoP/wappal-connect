/**
 * Script para criar índices de performance no banco de dados
 * Execute: node create_indexes.cjs
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://qoolzhzdcfnyblymdvbq.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function createIndexes() {
    console.log('🔧 Criando índices de performance...\n');

    const indexes = [
        {
            name: 'idx_messages_conversation_created',
            sql: `CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
            ON messages(conversation_id, created_at DESC)
            WHERE deleted_at IS NULL`,
            description: 'Mensagens por conversa (histórico)'
        },
        {
            name: 'idx_messages_unprocessed',
            sql: `CREATE INDEX IF NOT EXISTS idx_messages_unprocessed 
            ON messages(conversation_id, ai_processed)
            WHERE ai_processed = false AND from_me = false`,
            description: 'Mensagens não processadas'
        },
        {
            name: 'idx_conversations_chat_lid',
            sql: `CREATE INDEX IF NOT EXISTS idx_conversations_chat_lid 
            ON conversations(chat_lid)
            WHERE chat_lid IS NOT NULL`,
            description: 'Conversas por chat_lid'
        },
        {
            name: 'idx_conversations_contact',
            sql: `CREATE INDEX IF NOT EXISTS idx_conversations_contact 
            ON conversations(contact_id, created_at DESC)`,
            description: 'Conversas por contato'
        },
        {
            name: 'idx_contacts_phone',
            sql: `CREATE INDEX IF NOT EXISTS idx_contacts_phone 
            ON contacts(phone)
            WHERE phone IS NOT NULL`,
            description: 'Contatos por phone'
        },
        {
            name: 'idx_contacts_lid',
            sql: `CREATE INDEX IF NOT EXISTS idx_contacts_lid 
            ON contacts(lid)
            WHERE lid IS NOT NULL`,
            description: 'Contatos por LID'
        },
        {
            name: 'idx_protocols_conversation_status',
            sql: `CREATE INDEX IF NOT EXISTS idx_protocols_conversation_status 
            ON protocols(conversation_id, status)
            WHERE status = 'open'`,
            description: 'Protocolos abertos (idempotência)'
        },
        {
            name: 'idx_protocols_code',
            sql: `CREATE INDEX IF NOT EXISTS idx_protocols_code 
            ON protocols(protocol_code)`,
            description: 'Protocolos por código'
        },
        {
            name: 'idx_protocols_condominium_status',
            sql: `CREATE INDEX IF NOT EXISTS idx_protocols_condominium_status 
            ON protocols(condominium_id, status, created_at DESC)
            WHERE condominium_id IS NOT NULL`,
            description: 'Protocolos por condomínio'
        },
        {
            name: 'idx_participant_state_conversation',
            sql: `CREATE INDEX IF NOT EXISTS idx_participant_state_conversation 
            ON conversation_participant_state(conversation_id)`,
            description: 'Estado de participante'
        },
        {
            name: 'idx_participants_entity',
            sql: `CREATE INDEX IF NOT EXISTS idx_participants_entity 
            ON participants(entity_id, role_type)
            WHERE entity_id IS NOT NULL`,
            description: 'Participantes por entidade'
        },
        {
            name: 'idx_ai_logs_request_id',
            sql: `CREATE INDEX IF NOT EXISTS idx_ai_logs_request_id 
            ON ai_logs(request_id, created_at DESC)
            WHERE request_id IS NOT NULL`,
            description: 'Logs por correlation ID'
        },
        {
            name: 'idx_ai_logs_conversation_created',
            sql: `CREATE INDEX IF NOT EXISTS idx_ai_logs_conversation_created 
            ON ai_logs(conversation_id, created_at DESC)
            WHERE conversation_id IS NOT NULL`,
            description: 'Logs por conversa'
        },
        {
            name: 'idx_ai_logs_status_created',
            sql: `CREATE INDEX IF NOT EXISTS idx_ai_logs_status_created 
            ON ai_logs(status, created_at DESC)`,
            description: 'Logs por status'
        },
    ];

    let created = 0;
    let failed = 0;

    for (const index of indexes) {
        try {
            console.log(`Criando ${index.name}...`);
            console.log(`  → ${index.description}`);

            const { error } = await supabase.rpc('exec', { sql: index.sql });

            if (error) {
                // Tentar via query direta se RPC falhar
                throw error;
            }

            console.log(`  ✅ Criado\n`);
            created++;

        } catch (error) {
            console.error(`  ❌ Erro: ${error.message}\n`);
            failed++;
        }
    }

    console.log('='.repeat(50));
    console.log(`\n📊 Resultado:`);
    console.log(`✅ Criados: ${created}`);
    console.log(`❌ Falhas: ${failed}`);
    console.log(`📈 Taxa de sucesso: ${((created / indexes.length) * 100).toFixed(1)}%\n`);

    if (created > 0) {
        console.log('🎉 Índices criados! Performance deve melhorar significativamente.');
        console.log('\n💡 Dica: Execute ANALYZE nas tabelas para atualizar estatísticas:');
        console.log('   ANALYZE messages, conversations, contacts, protocols;');
    }
}

createIndexes().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});
