
-- Migration to create webhook_logs table for debugging
CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload JSONB,
    headers JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Grant permissions
GRANT INSERT ON public.webhook_logs TO service_role;
GRANT SELECT ON public.webhook_logs TO service_role;
