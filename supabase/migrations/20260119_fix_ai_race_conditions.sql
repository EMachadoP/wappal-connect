-- 🏁 FIX: PREVENÇÃO DE CORRIDA (RACE CONDITION) NA IA
-- Evita duplicidade de respostas e protocolos por gatilhos simultâneos.

BEGIN;

-- 1) Tabela de locks por conversa
CREATE TABLE IF NOT EXISTS public.ai_conversation_locks (
  conversation_id UUID PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para limpeza rápida de locks órfãos
CREATE INDEX IF NOT EXISTS idx_ai_conversation_locks_locked_at
  ON public.ai_conversation_locks(locked_at);

-- 2) Garantir apenas UM protocolo aberto por conversa (Idempotência no Banco)
-- Isso impede que duas transações quase simultâneas criem 2 protocolos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_protocols_one_open_per_conversation
ON public.protocols(conversation_id)
WHERE status IN ('open', 'queued', 'in_progress');

COMMIT;

-- ✅ Verificação
-- SELECT * FROM ai_conversation_locks;
