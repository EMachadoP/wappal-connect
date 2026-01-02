import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    console.log('[CREATE-AGENT] Function invoked');

    // Validate caller authentication
    const authHeader = req.headers.get('Authorization');
    console.log('[CREATE-AGENT] Auth header present:', !!authHeader);

    if (!authHeader) {
      console.log('[CREATE-AGENT] No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('[CREATE-AGENT] Token extracted, length:', token.length);

    // Use service role key to validate the token
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('[CREATE-AGENT] Validating token...');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    console.log('[CREATE-AGENT] Token validation - User:', !!user, 'Error:', !!authError);

    if (authError || !user) {
      console.log('[CREATE-AGENT] Invalid token:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Token inválido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[CREATE-AGENT] User authenticated:', user.id);

    // Check if caller has admin role
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    console.log('[CREATE-AGENT] Roles query - Data:', roles, 'Error:', !!rolesError);

    if (rolesError) {
      console.error('[CREATE-AGENT] Error fetching roles:', rolesError);
      return new Response(
        JSON.stringify({ error: 'Erro ao verificar permissões' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isAdmin = roles?.some(r => r.role === 'admin');
    console.log('[CREATE-AGENT] Is admin?', isAdmin);

    if (!isAdmin) {
      console.log('[CREATE-AGENT] User is not admin - REJECTING:', user.id);
      return new Response(
        JSON.stringify({ error: 'Acesso negado - Requer permissão de administrador' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[CREATE-AGENT] Admin user creating agent:', user.id);

    const rawBody = await req.json();

    // Input validation
    const MAX_NAME_LENGTH = 100;
    const MAX_EMAIL_LENGTH = 255;
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const email = typeof rawBody.email === 'string' ? rawBody.email.trim().slice(0, MAX_EMAIL_LENGTH) : '';
    const password = typeof rawBody.password === 'string' ? rawBody.password : '';
    const name = typeof rawBody.name === 'string' ? rawBody.name.trim().slice(0, MAX_NAME_LENGTH) : '';
    const team_id = rawBody.team_id && UUID_REGEX.test(rawBody.team_id) ? rawBody.team_id : null;

    console.log('[CREATE-AGENT] Creating agent:', { email, name, team_id });

    if (!email || !password || !name) {
      return new Response(
        JSON.stringify({ error: 'Email, senha e nome são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    if (!EMAIL_REGEX.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Formato de email inválido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate name length
    if (name.length < 2 || name.length > MAX_NAME_LENGTH) {
      return new Response(
        JSON.stringify({ error: 'Nome deve ter entre 2 e 100 caracteres' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate password strength server-side
    const hasMinLength = password.length >= 8;
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    if (!hasMinLength || !hasLowercase || !hasUppercase || !hasNumber) {
      return new Response(
        JSON.stringify({ error: 'Senha deve ter pelo menos 8 caracteres, incluindo maiúsculas, minúsculas e números' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user with admin API (doesn't log in)
    console.log('[CREATE-AGENT] Creating user in Supabase Auth...');
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError) {
      console.error('[CREATE-AGENT] Error creating user:', createError);
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    console.log('[CREATE-AGENT] User created:', userId);

    // Update profile with team if provided
    if (team_id) {
      console.log('[CREATE-AGENT] Updating profile with team_id:', team_id);
      await supabaseAdmin
        .from('profiles')
        .update({ team_id })
        .eq('id', userId);
    }

    // Add agent role
    console.log('[CREATE-AGENT] Adding agent role...');
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({ user_id: userId, role: 'agent' });

    if (roleError) {
      console.error('[CREATE-AGENT] Error adding role:', roleError);
    }

    console.log('[CREATE-AGENT] Agent created successfully:', userId);
    return new Response(
      JSON.stringify({ success: true, user_id: userId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[CREATE-AGENT] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
