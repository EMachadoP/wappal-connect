const https = require('https');
const url = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const key = "sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD";

// Correction 2: Merge conversations
const sql = `
DO $$
DECLARE
  v_manter_id UUID := '0785bc74-8392-4a8a-bb93-608ca38e5878';
  v_remover_id UUID := '7b258b67-dc95-4332-8d95-ccee782a38d8';
BEGIN
  -- 1. Transferir mensagens
  UPDATE messages 
  SET conversation_id = v_manter_id
  WHERE conversation_id = v_remover_id;

  -- 2. Transferir protocolos
  UPDATE protocols 
  SET conversation_id = v_manter_id
  WHERE conversation_id = v_remover_id;

  -- 3. Deletar conversa duplicada
  DELETE FROM conversations WHERE id = v_remover_id;

  RAISE NOTICE 'Merge concluído: % -> %', v_remover_id, v_manter_id;
END $$;
`;

async function executeSql(query) {
    const body = JSON.stringify({ query });
    const options = {
        hostname: 'qoolzhzdcfnyblymdvbq.supabase.co',
        path: '/rest/v1/rpc/dg_execute_sql',
        method: 'POST',
        headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer': 'params=single-object'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

executeSql(sql).then(res => {
    console.log('SQL Result:', res);
}).catch(console.error);
