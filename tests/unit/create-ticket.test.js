/**
 * Unit Tests: create-ticket Edge Function
 * 
 * Tests individual components and edge cases
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://qoolzhzdcfnyblymdvbq.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD'
);

async function runUnitTests() {
    console.log('🧪 Starting Unit Tests\n');
    let passed = 0;
    let failed = 0;

    // Test 1: Missing required parameters
    try {
        console.log('Test 1: Reject missing required parameters...');

        const { data, error } = await supabase.functions.invoke('create-ticket', {
            body: {
                // Missing conversation_id and summary
                priority: 'normal',
            }
        });

        if (!error && data.success) {
            throw new Error('Should have rejected missing parameters');
        }

        console.log('✅ Test 1 PASSED\n');
        passed++;
    } catch (error) {
        console.error('❌ Test 1 FAILED:', error.message, '\n');
        failed++;
    }

    // Test 2: Protocol code format
    try {
        console.log('Test 2: Validate protocol code format...');

        // Create a test conversation
        const { data: conv } = await supabase
            .from('conversations')
            .insert({
                contact_id: '50d3c381-d62c-494a-932b-f29801ca7736',
                chat_lid: 'test-unit-' + Date.now(),
                status: 'active',
            })
            .select()
            .single();

        const { data: ticket } = await supabase.functions.invoke('create-ticket', {
            body: {
                conversation_id: conv.id,
                contact_id: conv.contact_id,
                summary: 'Test protocol format',
            }
        });

        if (!ticket.protocol_code) {
            throw new Error('No protocol code returned');
        }

        // Format should be YYYYMM-NNNN
        const regex = /^\d{6}-\d{4}$/;
        if (!regex.test(ticket.protocol_code)) {
            throw new Error(`Invalid format: ${ticket.protocol_code}`);
        }

        // Cleanup
        await supabase.from('protocols').delete().eq('conversation_id', conv.id);
        await supabase.from('conversations').delete().eq('id', conv.id);

        console.log('✅ Test 2 PASSED\n');
        passed++;
    } catch (error) {
        console.error('❌ Test 2 FAILED:', error.message, '\n');
        failed++;
    }

    // Test 3: Priority and due_date calculation
    try {
        console.log('Test 3: Validate due_date calculation...');

        const { data: conv } = await supabase
            .from('conversations')
            .insert({
                contact_id: '50d3c381-d62c-494a-932b-f29801ca7736',
                chat_lid: 'test-priority-' + Date.now(),
                status: 'active',
            })
            .select()
            .single();

        // Test critical priority (same day)
        const { data: criticalTicket } = await supabase.functions.invoke('create-ticket', {
            body: {
                conversation_id: conv.id,
                contact_id: conv.contact_id,
                summary: 'Critical issue',
                priority: 'critical',
            }
        });

        const { data: protocol } = await supabase
            .from('protocols')
            .select('due_date, priority')
            .eq('protocol_code', criticalTicket.protocol_code)
            .single();

        if (protocol.priority !== 'critical') {
            throw new Error('Priority not set correctly');
        }

        const dueDate = new Date(protocol.due_date);
        const today = new Date();

        // Critical should be same day
        if (dueDate.toDateString() !== today.toDateString()) {
            throw new Error('Critical due_date should be same day');
        }

        // Cleanup
        await supabase.from('protocols').delete().eq('conversation_id', conv.id);
        await supabase.from('conversations').delete().eq('id', conv.id);

        console.log('✅ Test 3 PASSED\n');
        passed++;
    } catch (error) {
        console.error('❌ Test 3 FAILED:', error.message, '\n');
        failed++;
    }

    // Summary
    console.log('='.repeat(50));
    console.log(`\n📊 Unit Test Results:`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runUnitTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
