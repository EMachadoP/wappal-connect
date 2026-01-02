# 🚀 Scripts de Deploy

Este diretório contém scripts para facilitar o processo de deployment.

## 📜 Scripts Disponíveis

### 1. `release.ps1` ⭐ **RECOMENDADO**

**Script completo de release** - Automatiza TODO o processo de atualização.

**Quando usar:**
- Quando fizer qualquer mudança no projeto
- Quando quiser fazer um release completo
- Quando alterou Edge Functions

**Como usar:**

```powershell
.\release.ps1 "feat: descrição da mudança"
```

**O que faz:**
1. ✅ `git add .` - Adiciona todos os arquivos
2. ✅ `git commit` - Faz commit com sua mensagem
3. ✅ `git push` - Envia para GitHub
4. ✅ Deploy de **todas** as Edge Functions
5. ✅ Mostra resumo e links úteis

**Exemplo:**
```powershell
.\release.ps1 "fix: corrigir bug no login"
```

---

### 2. `quick-update.ps1`

**Atualização rápida** - Apenas commit e push (sem deploy de Edge Functions).

**Quando usar:**
- Mudanças apenas no frontend (`src/`)
- Documentação
- Quando NÃO alterou Edge Functions

**Como usar:**

```powershell
.\quick-update.ps1 "docs: atualizar README"
```

**O que faz:**
1. ✅ `git add .`
2. ✅ `git commit`
3. ✅ `git push`
4. ⏭️ Pula deploy de Edge Functions

---

### 3. `deploy-functions.ps1`

Deploy de **todas** as Edge Functions do Supabase de uma vez.

**Quando usar:**
- Quando fizer mudanças em qualquer Edge Function
- Quando quiser garantir que tudo está atualizado
- Após fazer merge de branches

**Como usar:**

```powershell
# No PowerShell (ou terminal do VS Code)
.\deploy-functions.ps1
```

**O que faz:**
1. Faz deploy de todas as 8 Edge Functions:
   - `zapi-webhook`
   - `protocol-opened`
   - `ai-maybe-reply`
   - `assign-conversation`
   - `transcribe-audio`
   - `zapi-send-message`
   - `create-agent`
   - `group-resolution-handler`

2. Mostra progresso de cada função
3. Exibe resumo no final (quantas tiveram sucesso/falha)

**Exemplo de saída:**

```
🚀 Iniciando deploy de todas as Edge Functions...

📦 Deploying zapi-webhook...
✅ zapi-webhook deployed successfully!

📦 Deploying protocol-opened...
✅ protocol-opened deployed successfully!

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Resumo do Deploy:
✅ Sucesso: 8
❌ Falhas: 0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 Todas as Edge Functions foram deployadas com sucesso!
```

---

## 🔧 Troubleshooting

### Erro: "Execution of scripts is disabled"

Se receber este erro ao executar o script:

```powershell
# Execute este comando UMA VEZ (como Administrador)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Erro: "npx: command not found"

Certifique-se de que o Node.js está instalado:

```powershell
node --version
npm --version
```

### Erro: "Supabase CLI not found"

O script usa `npx` que baixa automaticamente o Supabase CLI. Se der erro, tente:

```powershell
npm install -g supabase
```

---

## 📝 Notas

- O script **não** faz deploy do frontend (Vercel faz isso automaticamente)
- Cada função leva ~10-30 segundos para fazer deploy
- Deploy total: ~3-5 minutos para todas as funções
- Você precisa estar autenticado no Supabase (o CLI pede na primeira vez)

---

**Criado em:** 2026-01-02
