# 🚀 Processo de Release e Atualização

Este documento descreve o processo completo para fazer releases e atualizações do Wappal Connect.

---

## 📋 Índice

1. [Versionamento](#versionamento)
2. [Processo de Desenvolvimento](#processo-de-desenvolvimento)
3. [Checklist de Release](#checklist-de-release)
4. [Sequência de Atualização](#sequência-de-atualização)
5. [Rollback](#rollback)

---

## 🔢 Versionamento

Usamos [Versionamento Semântico](https://semver.org/lang/pt-BR/):

- **MAJOR** (X.0.0) - Mudanças incompatíveis (breaking changes)
- **MINOR** (0.X.0) - Novas funcionalidades compatíveis
- **PATCH** (0.0.X) - Correções de bugs

### Exemplos

- `1.0.0` → `1.0.1` - Correção de bug
- `1.0.1` → `1.1.0` - Nova funcionalidade
- `1.1.0` → `2.0.0` - Mudança incompatível

---

## 🔄 Processo de Desenvolvimento

### 1. Criar Branch de Feature (Opcional)

```bash
# Para features grandes
git checkout -b feature/nome-da-feature

# Para correções
git checkout -b fix/nome-do-bug
```

### 2. Fazer Mudanças

```bash
# Editar arquivos
# Testar localmente
npm run dev
```

### 3. Commit das Mudanças

```bash
git add .
git commit -m "feat: descrição da mudança"
```

**Convenção de Commits:**
- `feat:` - Nova funcionalidade
- `fix:` - Correção de bug
- `docs:` - Documentação
- `style:` - Formatação
- `refactor:` - Refatoração
- `test:` - Testes
- `chore:` - Manutenção

### 4. Push para GitHub

```bash
# Se estiver em branch
git push origin feature/nome-da-feature

# Se estiver em main
git push origin main
```

---

## ✅ Checklist de Release

### Antes do Release

- [ ] Todas as mudanças foram testadas localmente
- [ ] Código foi revisado
- [ ] Testes passando (se houver)
- [ ] Documentação atualizada
- [ ] CHANGELOG.md atualizado com as mudanças
- [ ] Versão atualizada em `package.json`

### Durante o Release

- [ ] Commit com as mudanças
- [ ] Tag de versão criada
- [ ] Push para GitHub
- [ ] Edge Functions deployadas (se necessário)
- [ ] Verificação de deployment no Vercel

### Após o Release

- [ ] Testar em produção
- [ ] Monitorar logs de erro
- [ ] Comunicar mudanças para equipe

---

## 🔄 Sequência de Atualização

### Passo 1: Atualizar CHANGELOG.md

```bash
# Abrir CHANGELOG.md
code CHANGELOG.md
```

Adicionar as mudanças na seção `[Não Lançado]`:

```markdown
## [Não Lançado]

### ✨ Adicionado
- Nova funcionalidade X

### 🐛 Corrigido
- Bug Y corrigido
```

### Passo 2: Atualizar Versão em package.json

```bash
# Abrir package.json
code package.json
```

Atualizar o campo `version`:

```json
{
  "version": "1.2.0"
}
```

### Passo 3: Mover Mudanças no CHANGELOG

Mover as mudanças de `[Não Lançado]` para uma nova versão:

```markdown
## [1.2.0] - 2026-01-02

### ✨ Adicionado
- Nova funcionalidade X

### 🐛 Corrigido
- Bug Y corrigido
```

### Passo 4: Commit e Tag

```bash
# Adicionar mudanças
git add CHANGELOG.md package.json

# Commit
git commit -m "chore: release v1.2.0"

# Criar tag
git tag -a v1.2.0 -m "Release v1.2.0"

# Push commit e tag
git push origin main
git push origin v1.2.0
```

### Passo 5: Deploy Edge Functions (Se Necessário)

Se você alterou Edge Functions no Supabase:

```bash
# Deploy de função específica
npx supabase functions deploy nome-da-funcao

# Ou deploy de todas
npx supabase functions deploy
```

**Funções principais:**
- `zapi-webhook` - Webhook do Z-API
- `protocol-opened` - Abertura de protocolos
- `ai-maybe-reply` - Respostas automáticas da IA
- `assign-conversation` - Atribuição de conversas
- `transcribe-audio` - Transcrição de áudios

### Passo 6: Verificar Deployment no Vercel

O Vercel faz deployment **automático** quando você faz push para `main`:

1. Acesse: https://vercel.com/eldons-projects-3194802d/wappal-connect/deployments
2. Aguarde o deployment completar (status "Ready")
3. Verifique se não há erros

**Se precisar forçar redeploy:**

```bash
# Commit vazio
git commit --allow-empty -m "chore: trigger redeploy"
git push origin main
```

### Passo 7: Testar em Produção

1. Acesse: https://wappal-connect.vercel.app
2. Teste funcionalidades críticas:
   - Login
   - Inbox
   - Envio de mensagens
   - Criação de protocolos
3. Verifique Console (F12) para erros

---

## 🔄 Fluxo Completo (Resumo)

```bash
# 1. Fazer mudanças no código
# ... editar arquivos ...

# 2. Testar localmente
npm run dev

# 3. Atualizar documentação
code CHANGELOG.md
code package.json

# 4. Commit e tag
git add .
git commit -m "chore: release v1.2.0"
git tag -a v1.2.0 -m "Release v1.2.0"

# 5. Push
git push origin main
git push origin v1.2.0

# 6. Deploy Edge Functions (se necessário)
npx supabase functions deploy zapi-webhook
npx supabase functions deploy protocol-opened

# 7. Verificar Vercel
# Acesse: https://vercel.com/.../deployments

# 8. Testar produção
# Acesse: https://wappal-connect.vercel.app
```

---

## 🔙 Rollback

Se algo der errado em produção:

### Opção 1: Rollback no Vercel (Rápido)

1. Acesse: https://vercel.com/eldons-projects-3194802d/wappal-connect/deployments
2. Encontre o deployment anterior que funcionava
3. Clique no menu **⋮** → **"Promote to Production"**

### Opção 2: Reverter Commit

```bash
# Reverter último commit
git revert HEAD

# Push
git push origin main
```

### Opção 3: Voltar para Tag Anterior

```bash
# Listar tags
git tag

# Voltar para tag
git checkout v1.1.0

# Criar branch
git checkout -b hotfix/rollback

# Push
git push origin hotfix/rollback
```

---

## 📊 Monitoramento

### Logs do Vercel

Acesse: https://vercel.com/eldons-projects-3194802d/wappal-connect/logs

### Logs do Supabase

Acesse: https://supabase.com/dashboard/project/qoolzhzdcfnyblymdvbq/logs/edge-functions

### Erros no Frontend

1. Abra a aplicação
2. F12 → Console
3. Verifique erros

---

## 🎯 Boas Práticas

1. **Sempre teste localmente** antes de fazer push
2. **Atualize o CHANGELOG** em toda mudança
3. **Use tags** para marcar releases
4. **Faça commits pequenos** e frequentes
5. **Escreva mensagens de commit claras**
6. **Documente breaking changes** no CHANGELOG
7. **Teste em produção** após deployment
8. **Monitore logs** após releases

---

## 📞 Suporte

Se tiver problemas durante o processo de release:

1. Verifique os logs do Vercel e Supabase
2. Consulte este documento
3. Faça rollback se necessário
4. Documente o problema para referência futura

---

**Última atualização:** 2026-01-02
