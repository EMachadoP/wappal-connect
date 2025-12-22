-- Add AI logs retention cleanup function (same 30-day retention as messages)
CREATE OR REPLACE FUNCTION public.cleanup_old_ai_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.ai_logs
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Deleted % AI logs older than 30 days', deleted_count;
END;
$$;

-- Grant execute only to service role
GRANT EXECUTE ON FUNCTION public.cleanup_old_ai_logs() TO service_role;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_ai_logs() FROM PUBLIC;