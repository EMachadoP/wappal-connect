# Correções do Planejamento

![Problemas Identificados](file:///C:/Users/eldon/.gemini/antigravity/brain/b611dcbc-d683-41e2-8fe5-662193625846/uploaded_image_1768356241481.png)
![Aijolan Skills](file:///C:/Users/eldon/.gemini/antigravity/brain/b611dcbc-d683-41e2-8fe5-662193625846/uploaded_image_1768356367094.png)

## Problemas Identificados

### 1. ❌ Aijolan não recebe agendamentos
**Causa**: **Aijolan não existe no banco de dados de produção** (retorna `null` na query). Apesar da UI mostrar que ele está cadastrado com skills, isso pode ser dados mockados ou de desenvolvimento local.

**Solução**: A migration cria o técnico "Aijolan Amaro" com todas as skills mostradas na screenshot:
- ANTENACOLETIVA, CERCAELTRICA, CFTV, CONCERTINA
- CONTROLEDEACESSOPEDESTRE, CONTROLEDEACESSOVEICULAR
- ENTREGADECONTROLE, ENTREGADEINTERFONE, INTERFONE
- PORTAO, PORTODEPEDESTREESSOVEICULAR

### 2. ❌ Texto "Visita técnica - Operacional" aparecendo
**Causa**: O `work_item_title` é genérico e estava sendo exibido quando não havia `protocol_summary`.

**Solução**: Ajustado o card para exibir apenas `protocol_summary` SE ele existir E for diferente de `work_item_title`.

### 3. ❌ "Condomínio não identificado"
**Causa**: A view `v_planning_week` não estava retornando os campos `condominium_name` e `protocol_summary`.

**Solução**: Recriada a view para incluir explicitamente esses campos.

## Arquivos Modificados

1. **Migration**: [`20260114000200_fix_planning_issues.sql`](file:///c:/Projetos/wappal-connect/supabase/migrations/20260114000200_fix_planning_issues.sql)
   - Recria `v_planning_week` com todos os campos necessários
   - **Cria o técnico Aijolan Amaro** com todas as skills
   - Se ele já existir, apenas garante que está ativo

2. **Frontend**: [`Planning.tsx`](file:///c:/Projetos/wappal-connect/src/pages/Planning.tsx)
   - Cards agora mostram apenas `protocol_summary` real (não o título genérico)
   - Esconde "Visita técnica - Operacional"

## Próximos Passos

1. **Aplicar Migration**: Rode `.\release.ps1 "Fix planning - add Aijolan"`
2. **Rebuild do Planejamento**: Clique em "Gerar Planejamento" novamente
3. **Resultado Esperado**:
   - ✅ Aijolan agora existe no banco e pode receber agendamentos
   - ✅ Cards mostram nome do condomínio correto
   - ✅ "Visita técnica" não aparece mais (só o resumo real do protocolo)
