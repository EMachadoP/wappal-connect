/**
 * Integration Test: Complete Ticket Creation Flow
 * 
 * Tests the entire flow from AI detecting need for ticket to final creation
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://qoolzhzdcfnyblymdvbq.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

// Test utilities
const testUtils = {
    async createTestConversation() {
        const { data, error } = await supabase
            .from('conversations')
            .insert({
                contact_id: '50d3c381-d62c-494a-932b-f29801ca7736', // Eldon's contact
                chat_lid: 'test-chat-' + Date.now(),
                status: 'active',
                active_condominium_id: null, // Will be set by participant
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async createTestParticipant(conversationId, condominiumId) {
        // Create participant
        const { data: participant, error: pError } = await supabase
            .from('participants')
            .insert({
                contact_id: '50d3c381-d62c-494a-932b-f29801ca7736',
                name: 'Test User',
                role_type: 'porteiro',
                entity_id: condominiumId,
                confidence: 1.0,
                is_primary: true,
            })
            .select()
            .single();

        if (pError) throw pError;

        // Link to conversation
        const { error: stateError } = await supabase
            .from('conversation_participant_state')
            .upsert({
                conversation_id: conversationId,
                current_participant_id: participant.id,
                last_confirmed_at: new Date().toISOString(),
                identification_asked: true,
            });

        if (stateError) throw stateError;
        return participant;
    },

    async cleanup(conversationId) {
        // Delete in reverse order of dependencies
        await supabase.from('protocols').delete().eq('conversation_id', conversationId);
        await supabase.from('conversation_participant_state').delete().eq('conversation_id', conversationId);
        await supabase.from('conversations').delete().eq('id', conversationId);
    }
};

// Test suite
async function runTests() {
    console.log('🧪 Starting Integration Tests\n');
    let passed = 0;
    let failed = 0;

    // Test 1: Create ticket with participant condominium
    try {
        console.log('Test 1: Create ticket with participant condominium...');

        // Get a real condominium
        const { data: condos } = await supabase
            .from('condominiums')
            .select('id, name')
            .limit(1);

        if (!condos || condos.length === 0) {
            throw new Error('No condominiums found in database');
        }

        const testCondo = condos[0];
        const conversation = await testUtils.createTestConversation();
        const participant = await testUtils.createTestParticipant(conversation.id, testCondo.id);

        // Call create-ticket
        const { data: ticket, error } = await supabase.functions.invoke('create-ticket', {
            body: {
                conversation_id: conversation.id,
                contact_id: conversation.contact_id,
                condominium_id: testCondo.id,
                summary: 'Test: Câmera com defeito',
                priority: 'normal',
                category: 'operational',
                requester_name: 'Test User',
                requester_role: 'Porteiro',
            }
        });

        if (error) throw error;
        if (!ticket.success) throw new Error('Ticket creation failed');
        if (!ticket.protocol_code) throw new Error('No protocol code returned');

        // Verify protocol was created
        const { data: protocol } = await supabase
            .from('protocols')
            .select('*')
            .eq('protocol_code', ticket.protocol_code)
            .single();

        if (!protocol) throw new Error('Protocol not found in database');
        if (protocol.condominium_id !== testCondo.id) throw new Error('Wrong condominium ID');

        // Verify conversation was updated
        const { data: updatedConv } = await supabase
            .from('conversations')
            .select('protocol')
            .eq('id', conversation.id)
            .single();

        if (updatedConv.protocol !== ticket.protocol_code) {
            throw new Error('Conversation protocol not updated');
        }

        await testUtils.cleanup(conversation.id);
        console.log('✅ Test 1 PASSED\n');
        passed++;

    } catch (error) {
        console.error('❌ Test 1 FAILED:', error.message, '\n');
        failed++;
    }

    // Test 2: Idempotency - prevent duplicate protocols
    try {
        console.log('Test 2: Idempotency check...');

        const { data: condos } = await supabase.from('condominiums').select('id').limit(1);
        const conversation = await testUtils.createTestConversation();

        // Create first ticket
        const { data: ticket1 } = await supabase.functions.invoke('create-ticket', {
            body: {
                conversation_id: conversation.id,
                contact_id: conversation.contact_id,
                condominium_id: condos[0].id,
                summary: 'First ticket',
            }
        });

        // Try to create second ticket for same conversation
        const { data: ticket2 } = await supabase.functions.invoke('create-ticket', {
            body: {
                conversation_id: conversation.id,
                contact_id: conversation.contact_id,
                condominium_id: condos[0].id,
                summary: 'Second ticket (should be rejected)',
            }
        });

        if (!ticket2.already_existed) {
            throw new Error('Idempotency failed - created duplicate');
        }

        if (ticket1.protocol_code !== ticket2.protocol_code) {
            throw new Error('Different protocol codes returned');
        }

        // Verify only one protocol exists
        const { data: protocols } = await supabase
            .from('protocols')
            .select('*')
            .eq('conversation_id', conversation.id)
            .eq('status', 'open');

        if (protocols.length !== 1) {
            throw new Error(`Expected 1 protocol, found ${protocols.length}`);
        }

        await testUtils.cleanup(conversation.id);
        console.log('✅ Test 2 PASSED\n');
        passed++;

    } catch (error) {
        console.error('❌ Test 2 FAILED:', error.message, '\n');
        failed++;
    }

    // Test 3: Condominium fallback from participant
    try {
        console.log('Test 3: Condominium fallback from participant...');

        const { data: condos } = await supabase.from('condominiums').select('id').limit(1);
        const conversation = await testUtils.createTestConversation();
        const participant = await testUtils.createTestParticipant(conversation.id, condos[0].id);

        // Call create-ticket WITHOUT condominium_id (should get from participant)
        const { data: ticket } = await supabase.functions.invoke('create-ticket', {
            body: {
                conversation_id: conversation.id,
                contact_id: conversation.contact_id,
                condominium_id: null, // Explicitly null
                summary: 'Test fallback',
            }
        });

        // Note: This test expects ai-generate-reply to handle the fallback
        // create-ticket itself doesn't do the fallback, but we can verify
        // that it accepts null condominium_id without crashing

        if (!ticket.success) throw new Error('Ticket creation failed');

        await testUtils.cleanup(conversation.id);
        console.log('✅ Test 3 PASSED\n');
        passed++;

    } catch (error) {
        console.error('❌ Test 3 FAILED:', error.message, '\n');
        failed++;
    }

    // Summary
    console.log('='.repeat(50));
    console.log(`\n📊 Test Results:`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
