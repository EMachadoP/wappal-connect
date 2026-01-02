# 🔑 Problema Identificado: Chave Supabase Incorreta

## Causa Raiz do Erro 401

O arquivo `.env` contém uma chave incorreta:
```
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_yAb6WSXmEbrOlGxN2wtQRg_C-MWmXqp"
```

Esta **NÃO é uma chave válida do Supabase**. Deveria ser a **ANON KEY** (um JWT longo).

---

## Como Obter a Chave Correta

### 1. Acesse o Supabase Dashboard
- Vá para: https://app.supabase.com
- Selecione o projeto: `qoolzhzdcfnyblymdvbq`

### 2. Navegue para Settings → API
- No menu lateral: **Project Settings** → **API**

### 3. Copie a ANON KEY
- Procure por: **Project API keys**
- Copie a chave **anon** / **public**
- Ela deve ser um JWT longo, começando com `eyJ...`

---

## Como Atualizar o .env

Edite o arquivo `c:\Projetos\wappal-connect\.env`:

```env
VITE_SUPABASE_PROJECT_ID="mifoqjuhwljudovtuoka"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzUwNjM0MzIsImV4cCI6MjA1MDYzOTQzMn0.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
VITE_SUPABASE_URL="https://qoolzhzdcfnyblymdvbq.supabase.co"
```

**IMPORTANTE**: Substitua o valor de `VITE_SUPABASE_PUBLISHABLE_KEY` pela chave **anon** que você copiou do Dashboard.

---

## Após Atualizar

1. **Reinicie o servidor de desenvolvimento**:
   ```bash
   # Pare o servidor (Ctrl+C)
   # Inicie novamente
   npm run dev
   ```

2. **Faça hard refresh no navegador**:
   - Windows/Linux: `Ctrl + Shift + R`
   - Mac: `Cmd + Shift + R`

3. **Tente criar um agente novamente**

---

## Por que isso causava o erro 401?

A chave `sb_publishable_...` não é reconhecida pelo Supabase como uma chave válida, então:
1. O cliente Supabase não consegue autenticar corretamente
2. O token JWT gerado não é válido para o projeto
3. A Edge Function rejeita o token com 401 Unauthorized

Com a chave **anon** correta, o token será válido e a autenticação funcionará!
