# Guia Completo - Resolver Planejamento

## Diagnóstico Confirmado ✅

1. **Banco de produção está vazio** - não há protocolos
2. **View `v_planning_week` está quebrada** - erro `column condominium_name does not exist`
3. **Dados na tela são de desenvolvimento local** - não existem no Supabase
4. **DnD JÁ ESTÁ IMPLEMENTADO** - código correto, apenas precisa de dados reais

## Solução em 3 Passos

### PASSO 1: Consertar a View

Cole no **Supabase SQL Editor**:

📄 Arquivo: [`STEP1_FIX_VIEW.sql`](file:///c:/Projetos/wappal-connect/STEP1_FIX_VIEW.sql)

Esse SQL:
- Garante que `technicians.is_wildcard` existe
- Recria `v_planning_week` com todas as colunas corretas
- Valida no final

**Resultado esperado:** View criada sem erros.

---

### PASSO 2: Popular com Dados de Teste

Cole no **Supabase SQL Editor**:

📄 Arquivo: [`STEP2_SEED_TEST_DATA.sql`](file:///c:/Projetos/wappal-connect/STEP2_SEED_TEST_DATA.sql)

Esse SQL cria:
- 2 condomínios teste
- 2 protocolos com resumos reais
- 2 work items
- 2 plan items (cards) agendados para terça-feira (13/01)

**Resultado esperado:** Query final retorna 2 linhas com dados completos.

---

### PASSO 3: Testar no Frontend

1. **Abra o Planejamento** na UI (https://wappal-connect.vercel.app)

2. **Confirme que aparece:**
   - ✅ Nome do condomínio (ex: "Condomínio Residencial Teste")
   - ✅ Resumo do protocolo (ex: "CFTV sem imagem...")
   - ✅ Código do protocolo (ex: "TEST-0001-AAA")

3. **Teste Drag & Drop:**
   - Arraste um card para outro dia/técnico
   - Deve mostrar toast "Agendamento movido"
   - Refresh da página → mudança persistiu

---

## Validação Final

**Console do Browser (DevTools):**
- **Network** → Deve mostrar requests para:
  - `https://qoolzhzdcfnyblymdvbq.supabase.co/rest/v1/v_planning_week`
- **Sem erros** de `column does not exist`

**Se algo der errado:**

- View ainda com erro? → Copie a mensagem exata e me mande
- Dados não aparecem? → Rode no SQL Editor:
  ```sql
  SELECT * FROM v_planning_week LIMIT 5;
  ```
  E me mande o resultado

- DnD não move? → Abra console e arraste → copie o erro

---

## Estrutura do DnD Implementado

**Já está no código** (`Planning.tsx`):

```typescript
const handleDragEnd = async (event: any) => {
  const { active, over } = event;
  if (!over) return;

  const draggedId = active.id;
  const [targetTechId, targetDate] = over.id.split(':');

  // Optimistic UI update
  setPlanItems(updatedItems);

  // Persist to database
  await supabase
    .from('plan_items')
    .update({ technician_id: targetTechId, plan_date: targetDate })
    .match({ id: draggedId });

  toast.success('Agendamento movido');
};
```

**Separador:** `:` (ex: `techId:2026-01-13`)

**Bibliotecas:** `@dnd-kit/core` já instalada

---

## Próximos Passos (Depois de Funcionar)

1. Gerar protocolos reais via UI
2. Rodar `rebuild-plan` para agendar automaticamente
3. Ajustar horários se necessário (atualmente só move dia+técnico)
4. Implementar validação de capacidade no DnD (opcional)
