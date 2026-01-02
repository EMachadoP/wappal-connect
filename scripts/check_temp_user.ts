import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://qoolzhzdcfnyblymdvbq.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkUser() {
    console.log('🔍 Verificando usuário admin.temp@wappal.local...\n');

    // Check in auth.users
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
        console.error('❌ Erro ao buscar usuários:', authError.message);
        return;
    }

    const tempUser = authUsers.users.find(u => u.email === 'admin.temp@wappal.local');

    if (!tempUser) {
        console.log('❌ Usuário admin.temp@wappal.local NÃO encontrado no auth.users');
        console.log('\n📋 Usuários encontrados:');
        authUsers.users.forEach(u => {
            console.log(`  - ${u.email} (ID: ${u.id})`);
        });
        return;
    }

    console.log('✅ Usuário encontrado no auth.users:');
    console.log(`  - Email: ${tempUser.email}`);
    console.log(`  - ID: ${tempUser.id}`);
    console.log(`  - Email confirmado: ${tempUser.email_confirmed_at ? 'Sim' : 'Não'}`);
    console.log(`  - Criado em: ${tempUser.created_at}`);

    // Check in profiles
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', tempUser.id)
        .maybeSingle();

    if (profileError) {
        console.log('\n❌ Erro ao buscar profile:', profileError.message);
    } else if (!profile) {
        console.log('\n❌ Profile NÃO encontrado para este usuário');
    } else {
        console.log('\n✅ Profile encontrado:');
        console.log(`  - Nome: ${profile.name}`);
        console.log(`  - Ativo: ${profile.is_active}`);
    }

    // Check roles
    const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', tempUser.id);

    if (rolesError) {
        console.log('\n❌ Erro ao buscar roles:', rolesError.message);
    } else if (!roles || roles.length === 0) {
        console.log('\n❌ Nenhuma role encontrada para este usuário');
    } else {
        console.log('\n✅ Roles encontradas:');
        roles.forEach(r => {
            console.log(`  - ${r.role}`);
        });
    }
}

checkUser().catch(console.error);
