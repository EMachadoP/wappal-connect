import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function mergeConversations(sourceConvId: string, targetConvId: string) {
    console.log(`Iniciando merge: ${sourceConvId} -> ${targetConvId}`);

    // 1. Mover mensagens
    const { error: msgError } = await supabase
        .from('messages')
        .update({ conversation_id: targetConvId })
        .eq('conversation_id', sourceConvId);

    if (msgError) {
        console.error('Erro ao mover mensagens:', msgError);
        return;
    }
    console.log('Mensagens movidas com sucesso.');

    // 2. Mover labels (se existirem)
    const { error: labelError } = await supabase
        .from('conversation_labels')
        .update({ conversation_id: targetConvId })
        .eq('conversation_id', sourceConvId);

    // Ignoramos erro de duplicidade aqui caso a conversa alvo já tenha a mesma label
    if (labelError && labelError.code !== '23505') {
        console.error('Erro ao mover labels:', labelError);
    }

    // 3. Deletar conversa antiga
    const { error: delConvError } = await supabase
        .from('conversations')
        .delete()
        .eq('id', sourceConvId);

    if (delConvError) {
        console.error('Erro ao deletar conversa antiga:', delConvError);
        return;
    }
    console.log('Conversa antiga deletada.');

    console.log('Merge concluído com sucesso.');
}

// Merge específico para G7 Serv identificado
// Personal LID (Target): d8f17a06-b05f-42e4-b978-0c4f64ca527d
// Hybrid Group (Source): c42d5850-ed1a-4cb8-8b1b-329817416a3c
// mergeConversations('c42d5850-ed1a-4cb8-8b1b-329817416a3c', 'd8f17a06-b05f-42e4-b978-0c4f64ca527d');

// Merge Karla Myrella
// 66e3870d-faf4-48c9-b6a8-de7635a47c2f -> fecc6b65-e488-4dee-adcc-1232703c85f4
// await mergeConversations('66e3870d-faf4-48c9-b6a8-de7635a47c2f', 'fecc6b65-e488-4dee-adcc-1232703c85f4');

// Merge G7 Serv Groups
// Source: G7 Serv Group Test (76f27831-45e7-45d0-bf23-b910c4967e42)
// Target: G7 Serv Grupo (c45d4d74-3c57-4c7c-921a-820e86e6cf7d) - Main group
// await mergeConversations('76f27831-45e7-45d0-bf23-b910c4967e42', 'c45d4d74-3c57-4c7c-921a-820e86e6cf7d');

// Merge Eldon (Outbound Split) -> G7 Serv (Inbound Canonical)
// Source: Eldon (50d3c381-d62c-494a-932b-f29801ca7736) - ID from DB audit
// Target: G7 Serv (87aab52b-90ec-4262-8d3b-169bb5a82e87) - ID from DB audit
await mergeConversations('50d3c381-d62c-494a-932b-f29801ca7736', '87aab52b-90ec-4262-8d3b-169bb5a82e87');
