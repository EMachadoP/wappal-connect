-- ============================================
-- TESTE DA RPC resolve_contact_identity
-- ============================================

-- Teste 1: Contato com phone
SELECT * FROM public.resolve_contact_identity(
  NULL,                    -- p_lid
  '5581974384321',         -- p_phone
  NULL,                    -- p_chat_lid
  '5581974384321@s.whatsapp.net', -- p_chat_id
  'Teste Contato'          -- p_name
);

-- Teste 2: Contato com LID
SELECT * FROM public.resolve_contact_identity(
  '123456789012345@lid',   -- p_lid
  NULL,                    -- p_phone
  '123456789012345@lid',   -- p_chat_lid
  '123456789012345@lid',   -- p_chat_id
  'Contato LID'            -- p_name
);

-- Teste 3: Contato que pode duplicar chat_lid (cenário 23505)
SELECT * FROM public.resolve_contact_identity(
  '999888777666555@lid',   -- p_lid
  '5581999887766',         -- p_phone
  '999888777666555@lid',   -- p_chat_lid
  '5581999887766@s.whatsapp.net', -- p_chat_id
  'Teste Duplicado'        -- p_name
);

-- ============================================
-- DIAGNÓSTICO: Logs de mensagens descartadas
-- ============================================

-- 1. Mensagens marcadas como "webhook_dropped" (últimas 50)
SELECT 
  created_at,
  status,
  input_excerpt,
  error_message
FROM ai_logs
WHERE status IN ('webhook_dropped', 'webhook_received')
ORDER BY created_at DESC
LIMIT 50;

-- 2. Buscar payloads com status mas sem text/message (potencial falso-positivo)
SELECT 
  created_at,
  input_excerpt
FROM ai_logs
WHERE status = 'webhook_dropped'
  AND input_excerpt LIKE '%status=%'
  AND input_excerpt NOT LIKE '%type=chatState%'
ORDER BY created_at DESC
LIMIT 20;

-- 3. Verificar se há mensagens com body/caption que foram ignoradas
SELECT 
  created_at,
  input_excerpt
FROM ai_logs
WHERE status = 'webhook_received'
  AND (
    input_excerpt LIKE '%"body"%'
    OR input_excerpt LIKE '%"caption"%'
  )
ORDER BY created_at DESC
LIMIT 20;
