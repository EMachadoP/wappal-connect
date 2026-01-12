import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

async function fixBucketRLS() {
    console.log('=== CONFIGURANDO RLS DO BUCKET MEDIA-FILES ===\n');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Executar SQL para criar políticas RLS
    const { error } = await supabase.rpc('exec_sql', {
        sql: `
      -- Permitir uploads autenticados
      DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
      CREATE POLICY "Allow authenticated uploads" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'media-files');

      -- Permitir leitura pública
      DROP POLICY IF EXISTS "Allow public read media-files" ON storage.objects;
      CREATE POLICY "Allow public read media-files" ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = 'media-files');
        
      -- Permitir atualizações autenticadas
      DROP POLICY IF EXISTS "Allow authenticated updates" ON storage.objects;
      CREATE POLICY "Allow authenticated updates" ON storage.objects
        FOR UPDATE TO authenticated
        USING (bucket_id = 'media-files');
        
      -- Permitir exclusões autenticadas  
      DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;
      CREATE POLICY "Allow authenticated deletes" ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = 'media-files');
    `
    });

    if (error) {
        console.log('⚠️ RPC não disponível, tentando via SQL direto...');

        // Alternativa: criar via API de storage
        // Vamos tentar atualizar o bucket para public
        const { error: updateError } = await supabase.storage.updateBucket('media-files', {
            public: true,
            fileSizeLimit: 52428800,
            allowedMimeTypes: ['*/*'] // Permitir todos os tipos temporariamente
        });

        if (updateError) {
            console.error('❌ Erro ao atualizar bucket:', updateError.message);
        } else {
            console.log('✅ Bucket atualizado para público');
        }
    } else {
        console.log('✅ Políticas RLS criadas');
    }

    console.log('\n=== FIM ===');
    console.log('\n⚠️ IMPORTANTE: Execute o SQL abaixo manualmente no SQL Editor do Supabase:');
    console.log(`
-- Permitir uploads autenticados
CREATE POLICY "Allow authenticated uploads media" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media-files');

-- Permitir leitura pública
CREATE POLICY "Allow public read media" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'media-files');
  `);
}

fixBucketRLS().catch(console.error);
