// Script para aplicar SQL via Supabase Management API
const SUPABASE_PROJECT_REF = 'qoolzhzdcfnyblymdvbq';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

async function executeSql() {
    console.log('=== APLICANDO POLÍTICAS RLS VIA API ===\n');

    const sql = `
    -- Permitir uploads autenticados
    CREATE POLICY IF NOT EXISTS "Allow authenticated uploads media" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'media-files');

    -- Permitir leitura pública
    CREATE POLICY IF NOT EXISTS "Allow public read media" ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'media-files');
  `;

    // Usar a API REST do PostgREST para executar SQL
    const response = await fetch(`https://${SUPABASE_PROJECT_REF}.supabase.co/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql })
    });

    if (!response.ok) {
        console.log('⚠️ RPC exec_sql não existe (esperado). Usando alternativa...\n');

        // Alternativa: Criar migration file e rodar via CLI
        console.log('Criando arquivo de migration...');

        // Vamos tentar via a API de banco de dados diretamente
        const pgResponse = await fetch(`https://${SUPABASE_PROJECT_REF}.supabase.co/rest/v1/`, {
            method: 'POST',
            headers: {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }
        });

        console.log('Status:', pgResponse.status);
    }

    console.log('\n=== TENTANDO VIA SUPABASE CLI ===');
}

executeSql().catch(console.error);
