-- Check for RLS policies that might be blocking the update
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename IN ('messages', 'conversations')
ORDER BY tablename, policyname;

-- Check if the service role has proper permissions
SELECT 
    table_schema,
    table_name,
    privilege_type
FROM information_schema.table_privileges 
WHERE grantee = 'service_role' 
AND table_name IN ('messages', 'conversations');
