-- Garantir que messages tenha REPLICA IDENTITY FULL para realtime funcionar corretamente
ALTER TABLE public.messages REPLICA IDENTITY FULL;