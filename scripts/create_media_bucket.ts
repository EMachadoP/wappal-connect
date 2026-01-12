import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = 'sb_secret_NqSXbtK16L98S52Lrj-EeQ_TxOxe4QD';

async function createMediaBucket() {
    console.log('=== CRIANDO BUCKET MEDIA-FILES ===\n');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Criar o bucket via API
    const { data: bucketData, error: bucketError } = await supabase.storage.createBucket('media-files', {
        public: true,
        fileSizeLimit: 52428800, // 50MB
        allowedMimeTypes: [
            'image/*',
            'video/*',
            'audio/*',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]
    });

    if (bucketError) {
        if (bucketError.message.includes('already exists')) {
            console.log('✅ Bucket já existe!');
        } else {
            console.error('❌ Erro ao criar bucket:', bucketError.message);
            return;
        }
    } else {
        console.log('✅ Bucket criado:', bucketData);
    }

    // 2. Listar buckets para confirmar
    const { data: buckets } = await supabase.storage.listBuckets();
    console.log('\n📦 Buckets disponíveis:');
    buckets?.forEach(b => console.log(`  - ${b.name} (public: ${b.public})`));

    console.log('\n=== FIM ===');
}

createMediaBucket().catch(console.error);
