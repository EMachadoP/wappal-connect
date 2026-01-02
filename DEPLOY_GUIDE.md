# Guia de Deploy na Vercel

## 📋 Pré-requisitos

- ✅ Conta no GitHub (ou GitLab/Bitbucket)
- ✅ Conta na Vercel (gratuita) - https://vercel.com
- ✅ Código commitado no Git

---

## 🚀 Passo a Passo

### 1. Preparar Repositório Git

```bash
# Se ainda não tem Git inicializado
git init

# Adicionar todos os arquivos
git add .

# Fazer commit
git commit -m "Preparar para deploy"

# Criar repositório no GitHub e fazer push
git remote add origin https://github.com/seu-usuario/wappal-connect.git
git branch -M main
git push -u origin main
```

### 2. Conectar à Vercel

1. Acesse https://vercel.com
2. Faça login com GitHub
3. Clique em "New Project"
4. Importe o repositório `wappal-connect`

### 3. Configurar Variáveis de Ambiente

Na página de configuração do projeto na Vercel, adicione:

```
VITE_SUPABASE_URL=https://qoolzhzdcfnyblymdvbq.supabase.co
VITE_SUPABASE_PROJECT_ID=qoolzhzdcfnyblymdvbq
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> ⚠️ **IMPORTANTE:** Use os mesmos valores do seu arquivo `.env` local!

### 4. Deploy

1. Clique em "Deploy"
2. Aguarde ~2 minutos
3. Pronto! Seu site estará no ar

---

## 🔄 Atualizações Futuras

### Automático (Recomendado)

```bash
# Fazer mudanças no código
git add .
git commit -m "Descrição da mudança"
git push
```

✅ Vercel detecta e faz deploy automaticamente!

### Manual

1. Acesse o dashboard da Vercel
2. Vá em "Deployments"
3. Clique em "Redeploy"

---

## ✅ Verificação Pós-Deploy

1. **Teste o login** com suas credenciais
2. **Verifique as conversas** aparecem
3. **Teste atribuição** de conversas
4. **Confirme filtros** funcionando

---

## 🔧 Configuração Avançada

### Domínio Personalizado

1. Vá em "Settings" → "Domains"
2. Adicione seu domínio
3. Configure DNS conforme instruções

### Preview Deployments

- Cada branch/PR gera um preview automático
- Teste antes de fazer merge para `main`

### Logs e Monitoramento

- Acesse "Deployments" → Clique no deploy → "View Function Logs"
- Monitore erros em tempo real

---

## 📝 Arquivos Criados

- ✅ `vercel.json` - Configuração do projeto
- ✅ `DEPLOY_GUIDE.md` - Este guia

---

## 🆘 Troubleshooting

### Build falha

- Verifique se `npm run build` funciona localmente
- Confira se todas as dependências estão no `package.json`

### Variáveis de ambiente não funcionam

- Certifique-se que começam com `VITE_`
- Redeploy após adicionar variáveis

### Site carrega mas não funciona

- Verifique as variáveis de ambiente
- Confira console do navegador para erros
- Verifique se Supabase URL está correta

---

## 🎉 Pronto!

Seu projeto está preparado para deploy. Quando quiser publicar, basta seguir este guia!
