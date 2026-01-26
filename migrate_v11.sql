-- =====================================================
-- ATOMIC CONVERSATION LOCKING (V11)
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) RPC para adquirir lock de forma atômica (Postgres clock)
CREATE OR REPLACE FUNCTION public.acquire_conversation_lock(
    p_conversation_id UUID,
    p_ttl_seconds INT DEFAULT 60
)
RETURNS TABLE (
    ok BOOLEAN,
    token TEXT,
    until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT := gen_random_uuid()::text;
    v_now   TIMESTAMPTZ := now();
    v_until TIMESTAMPTZ := v_now + (p_ttl_seconds || ' seconds')::interval;
    v_affected_rows INT;
BEGIN
    UPDATE public.conversations
    SET processing_until = v_until,
        processing_token = v_token
    WHERE id = p_conversation_id
      AND (processing_until IS NULL OR processing_until < v_now);

    GET DIAGNOSTICS v_affected_rows = ROW_COUNT;

    IF v_affected_rows = 1 THEN
        RETURN QUERY SELECT true, v_token, v_until;
    ELSE
        RETURN QUERY SELECT false, NULL::TEXT, NULL::TIMESTAMPTZ;
    END IF;
END;
$$;

-- 2) RPC para liberar lock (garante que só o dono libera)
CREATE OR REPLACE FUNCTION public.release_conversation_lock(
    p_conversation_id UUID,
    p_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_affected_rows INT;
BEGIN
    UPDATE public.conversations
    SET processing_until = NULL,
        processing_token = NULL
    WHERE id = p_conversation_id
      AND processing_token = p_token;

    GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
    RETURN v_affected_rows = 1;
END;
$$;

-- 3) Permissões de execução
GRANT EXECUTE ON FUNCTION public.acquire_conversation_lock(UUID, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_conversation_lock(UUID, TEXT) TO anon, authenticated, service_role;

-- 4) Ajuste de esquema para logging padronizado
ALTER TABLE public.ai_logs ADD COLUMN IF NOT EXISTS skip_reason TEXT;
ALTER TABLE public.ai_logs ADD COLUMN IF NOT EXISTS meta JSONB;

-- 5) Limpeza final (1x) — remove “locks órfãos” do bug antigo
UPDATE public.conversations
SET processing_until = now() - interval '1 second',
    processing_token = NULL
WHERE processing_until > now();

-- 6) Reload Schema Cache
NOTIFY pgrst, 'reload schema';
