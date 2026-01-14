# Fix para o Erro 500 no rebuild-plan

## Diagnóstico

✅ **Causa Identificada**: A coluna `is_wildcard` não existe na tabela `technicians` em produção.

**Evidência**:
```
Technicians columns: [ 'id', 'name', 'is_active', 'created_at', 'dispatch_priority' ]
```

A migration `20260114000100_planning_enhancements_v5.sql` foi enviada ao GitHub mas **não foi aplicada** ao banco Supabase.

## Solução (2 passos)

### Passo 1: Aplicar a Migration Manualmente

Acesse o **Supabase SQL Editor** e execute:

```sql
-- 1) Adicionar coluna is_wildcard
ALTER TABLE technicians 
ADD COLUMN IF NOT EXISTS is_wildcard BOOLEAN NOT NULL DEFAULT false;

-- 2) Marcar André como wildcard
UPDATE technicians 
SET is_wildcard = true 
WHERE name ILIKE '%André%';

-- 3) Criar índice
CREATE INDEX IF NOT EXISTS idx_technicians_active ON technicians(is_active);

-- 4) Recriar view (caso não exista ainda)
CREATE OR REPLACE VIEW v_planning_week AS
SELECT
  pi.id,
  pi.plan_date,
  pi.start_minute,
  pi.end_minute,
  pi.sequence,
  pi.assignment_group_id,
  pi.technician_id,
  t.name as technician_name,
  t.is_wildcard,

  wi.id as work_item_id,
  wi.title as work_item_title,
  wi.priority as work_item_priority,
  wi.status as work_item_status,
  wi.estimated_minutes,
  wi.required_people,
  wi.required_skill_codes,

  p.id as protocol_id,
  p.protocol_code,
  p.conversation_id,
  p.summary as protocol_summary,
  p.priority as protocol_priority,
  p.category as protocol_category,

  c.id as condominium_id,
  c.name as condominium_name

FROM plan_items pi
JOIN technicians t ON t.id = pi.technician_id
JOIN protocol_work_items wi ON wi.id = pi.work_item_id
JOIN protocols p ON p.id = wi.protocol_id
LEFT JOIN condominiums c ON c.id = p.condominium_id;
```

### Passo 2: Redeploy da Edge Function

Rode novamente o release para aplicar a versão melhorada do `rebuild-plan`:

```powershell
.\release.ps1 "Fix rebuild-plan error handling v5.1"
```

## O que foi melhorado no Edge Function

1. **Request ID**: Agora toda chamada tem um `reqId` único para rastreamento nos logs.
2. **Fallback Automático**: Se `is_wildcard` não existir, a função tenta novamente sem esse campo (evita crash total).
3. **Mensagens Claras**: Erros 500 agora retornam `{ ok: false, message: "...", reqId: "..." }`.
4. **Validação de Input**: Checa se `start_date` é válido antes de processar.

## Verificação

Após aplicar a migration e redeploy:

1. Acesse o Planejamento na UI
2. Clique em "Gerar Planejamento"
3. O rebuild deve funcionar sem erro 500
4. Se ainda houver erro, copie o `reqId` do toast e procure nos logs da função

## Nota Técnica

A view `v_planning_week` **já existe** em produção (confirmado), então o problema era apenas a coluna `is_wildcard` faltando na tabela `technicians`. Com o fallback implementado, mesmo que a migration falhe novamente, a função degradará gracefully (todos os técnicos serão tratados como `is_wildcard = false`).
