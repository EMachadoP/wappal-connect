-- Diagnóstico: Verificar se os dados foram criados

-- 1) Condominiums
SELECT 'Condominiums' as tabela, count(*) as total
FROM condominiums
WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- 2) Contacts
SELECT 'Contacts' as tabela, count(*) as total
FROM contacts
WHERE id = '33333333-3333-3333-3333-333333333333';

-- 3) Conversations
SELECT 'Conversations' as tabela, count(*) as total
FROM conversations
WHERE id IN ('44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555');

-- 4) Protocols
SELECT 'Protocols' as tabela, count(*) as total
FROM protocols
WHERE protocol_code IN ('TEST-0001-AAA', 'TEST-0002-BBB');

-- 5) Work Items
SELECT 'Work Items' as tabela, count(*) as total
FROM protocol_work_items
WHERE id IN ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999');

-- 6) Technicians
SELECT 'Technicians' as tabela, count(*) as total
FROM technicians
WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- 7) Plan Items
SELECT 'Plan Items' as tabela, count(*) as total
FROM plan_items
WHERE id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- 8) Verificar por que a view não retorna
SELECT 
  pi.id,
  pi.plan_date,
  t.name as tech_name,
  wi.title as work_title,
  p.protocol_code,
  c.name as condo_name
FROM plan_items pi
LEFT JOIN technicians t ON t.id = pi.technician_id
LEFT JOIN protocol_work_items wi ON wi.id = pi.work_item_id
LEFT JOIN protocols p ON p.id = wi.protocol_id
LEFT JOIN condominiums c ON c.id = p.condominium_id
WHERE pi.id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
