-- ========================================
-- PASSO 2: Seed Mínimo (dados de teste)
-- ========================================
-- Cole este SQL no Supabase SQL Editor
-- Cria: 1 condomínio, 1 conversa, 2 protocolos, 2 work items, 2 plan items

BEGIN;

-- 1) Criar condomínio teste
INSERT INTO condominiums (id, name, created_at)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Condomínio Residencial Teste', NOW()),
  ('22222222-2222-2222-2222-222222222222', 'Edifício Comercial Teste', NOW())
ON CONFLICT (id) DO NOTHING;

-- 2) Criar contato teste
INSERT INTO contacts (id, name, phone, created_at)
VALUES ('33333333-3333-3333-3333-333333333333', 'Morador Teste', '+5511999999999', NOW())
ON CONFLICT (id) DO NOTHING;

-- 3) Criar conversas teste
INSERT INTO conversations (
  id, thread_key, contact_id, active_condominium_id, 
  active_condominium_confidence, status, created_at
)
VALUES 
  (
    '44444444-4444-4444-4444-444444444444',
    'test-conv-1',
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    0.95,
    'open',
    NOW()
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    'test-conv-2',
    '33333333-3333-3333-3333-333333333333',
    '22222222-2222-2222-2222-222222222222',
    0.85,
    'open',
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- 4) Criar protocolos
INSERT INTO protocols (
  id, protocol_code, conversation_id, contact_id, condominium_id,
  category, priority, summary, status, created_at
)
VALUES 
  (
    '66666666-6666-6666-6666-666666666666',
    'TEST-0001-AAA',
    '44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'operational',
    'urgent',
    'CFTV sem imagem na entrada principal',
    'open',
    NOW()
  ),
  (
    '77777777-7777-7777-7777-777777777777',
    'TEST-0002-BBB',
    '55555555-5555-5555-5555-555555555555',
    '33333333-3333-3333-3333-333333333333',
    '22222222-2222-2222-2222-222222222222',
    'operational',
    'normal',
    'Portão travando ao abrir',
    'open',
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- 5) Criar work items
INSERT INTO protocol_work_items (
  id, protocol_id, title, status, priority,
  estimated_minutes, required_people, required_skill_codes,
  criticality, sla_business_days, created_at
)
VALUES 
  (
    '88888888-8888-8888-8888-888888888888',
    '66666666-6666-6666-6666-666666666666',
    'Manutenção CFTV',
    'open',
    'urgent',
    90,
    1,
    ARRAY['CFTV'],
    'critical',
    0,
    NOW()
  ),
  (
    '99999999-9999-9999-9999-999999999999',
    '77777777-7777-7777-7777-777777777777',
    'Reparo Portão',
    'open',
    'normal',
    120,
    1,
    ARRAY['PORTAO'],
    'non_critical',
    2,
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- 6) Criar ou garantir técnicos
INSERT INTO technicians (id, name, is_active, dispatch_priority, is_wildcard, created_at)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Edimar dos Santos', true, 10, false, NOW()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Vinícius Costa', true, 20, false, NOW())
ON CONFLICT (id) DO NOTHING;

-- 7) Criar plan items (agendamento)
-- Segunda 08:00-09:30 para Edimar (CFTV)
-- Segunda 09:00-11:00 para Vinícius (Portão)
INSERT INTO plan_items (
  id, plan_date, start_minute, end_minute, sequence,
  technician_id, work_item_id, created_at
)
VALUES 
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    DATE '2026-01-13', -- Terça desta semana
    480,  -- 08:00
    570,  -- 09:30
    1,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '88888888-8888-8888-8888-888888888888',
    NOW()
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    DATE '2026-01-13', -- Mesma terça
    540,  -- 09:00
    660,  -- 11:00
    2,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '99999999-9999-9999-9999-999999999999',
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Validação: ver os cards criados
SELECT 
  protocol_code, 
  condominium_name, 
  protocol_summary,
  technician_name,
  plan_date
FROM v_planning_week
ORDER BY plan_date, start_minute;

-- Deve retornar 2 linhas com dados reais!
