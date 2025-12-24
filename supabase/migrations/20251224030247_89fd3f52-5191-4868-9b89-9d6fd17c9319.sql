
-- Set REPLICA IDENTITY FULL on conversations for complete realtime updates
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
