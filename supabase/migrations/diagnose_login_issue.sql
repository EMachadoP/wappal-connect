-- Comprehensive diagnostic script to check database state
-- Run this in Supabase SQL Editor to diagnose the login issue

-- 1. Check if handle_new_user function has ON CONFLICT clause
SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure);

-- 2. Check if user exists in auth.users
SELECT 
  id,
  email,
  email_confirmed_at,
  created_at,
  raw_user_meta_data
FROM auth.users
WHERE email = 'admin.temp@wappal.local';

-- 3. Check if profile exists
SELECT *
FROM public.profiles
WHERE email = 'admin.temp@wappal.local';

-- 4. Check if roles exist
SELECT *
FROM public.user_roles ur
JOIN auth.users u ON ur.user_id = u.id
WHERE u.email = 'admin.temp@wappal.local';

-- 5. Check for any database triggers that might be failing
SELECT 
  tgname AS trigger_name,
  tgrelid::regclass AS table_name,
  proname AS function_name,
  tgenabled AS enabled
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgrelid::regclass::text LIKE '%auth.users%'
   OR tgrelid::regclass::text LIKE '%profiles%';

-- 6. Test the handle_new_user function manually
-- This will show if there's an error in the function itself
DO $$
DECLARE
  test_record RECORD;
BEGIN
  -- Create a test record similar to what would be inserted
  SELECT 
    gen_random_uuid() as id,
    'test@example.com' as email,
    '{"name": "Test User"}'::jsonb as raw_user_meta_data
  INTO test_record;
  
  -- Try to insert into profiles using the same logic as handle_new_user
  BEGIN
    INSERT INTO public.profiles (id, email, name)
    VALUES (
      test_record.id,
      test_record.email,
      COALESCE(test_record.raw_user_meta_data ->> 'name', split_part(test_record.email, '@', 1))
    )
    ON CONFLICT (id) DO NOTHING;
    
    RAISE NOTICE 'Test insert successful';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test insert failed: %', SQLERRM;
  END;
  
  -- Clean up
  DELETE FROM public.profiles WHERE id = test_record.id;
END $$;
