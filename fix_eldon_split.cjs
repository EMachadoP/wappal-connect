
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const supabaseKey = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";
const supabase = createClient(supabaseUrl, supabaseKey);

const CORRECT_CONTACT_ID = "50d3c381-d62c-494a-932b-f29801ca7736"; // phone: 558197438430
const WRONG_CONTACT_ID = "18a9c49a-efb4-47af-af31-6052fa010709";   // lid: 144723385778292

const CORRECT_CONV_ID = "095d7134-602c-43c8-becb-221f995ae8d1";
const WRONG_CONV_ID = "e103fd8d-0cc5-4dbd-b0e9-d71a75cbe89d";

const CORRECT_PARTICIPANT_ID = "c9618d9d-330c-4c3b-b0e4-99ae51c32ce0";
const WRONG_PARTICIPANT_ID = "d7c59d45-d7f5-45de-8520-c5647619d6b5";

async function fix() {
    console.log("Starting fix for Eldon's split conversation...");

    // 1. Move protocols participant association
    console.log("Moving protocols participant link...");
    await supabase
        .from('protocols')
        .update({ participant_id: CORRECT_PARTICIPANT_ID })
        .eq('participant_id', WRONG_PARTICIPANT_ID);

    // 2. Point all messages from the wrong conversation to the correct one
    console.log("Moving messages...");
    await supabase
        .from('messages')
        .update({ conversation_id: CORRECT_CONV_ID })
        .eq('conversation_id', WRONG_CONV_ID);

    // 3. Point all protocols to correct conversation
    console.log("Moving protocols conv link...");
    await supabase
        .from('protocols')
        .update({ conversation_id: CORRECT_CONV_ID })
        .eq('conversation_id', WRONG_CONV_ID);

    // 4. Delete the wrong participant "G7 Serv"
    console.log("Deleting wrong participants...");
    const { error: partErr } = await supabase
        .from('participants')
        .delete()
        .eq('id', WRONG_PARTICIPANT_ID);

    if (partErr) console.error("Error deleting participant:", partErr);

    // 5. Update the correct contact to ensure it HAS the chat_lid
    console.log("Updating correct contact with LID...");
    await supabase
        .from('contacts')
        .update({ chat_lid: "144723385778292@lid", lid: "144723385778292@lid" })
        .eq('id', CORRECT_CONTACT_ID);

    // 6. Delete the redundant conversation
    console.log("Deleting redundant conversation...");
    await supabase.from('conversations').delete().eq('id', WRONG_CONV_ID);

    // 7. Delete the redundant contact
    console.log("Deleting redundant contact...");
    await supabase.from('contacts').delete().eq('id', WRONG_CONTACT_ID);

    console.log("Fix completed successfully!");
}

fix();
