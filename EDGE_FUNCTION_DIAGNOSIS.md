# Diagnóstico: Edge Function create-agent não recebe requisições

## Problema

A Edge Function `create-agent` retorna erro 401, mas **não há logs de invocação** no Supabase Dashboard.

## Evidências

1. **Logs da Edge Function mostram apenas**:
   - "shutdown"
   - "Listening on http://localhost:9999/"
   - "booted"

2. **Logs NÃO mostram**:
   - ❌ Requisições HTTP
   - ❌ Mensagens de erro de autenticação
   - ❌ Logs personalizados do código

3. **Frontend está configurado corretamente**:
   - ✅ Usa `supabase.functions.invoke('create-agent', {...})`
   - ✅ Passa body com dados corretos
   - ✅ Tem sessão ativa (confirmado nos logs do console)

## Possíveis Causas

### 1. Edge Function não está deployada
**Mais provável!**

A função existe no código local mas pode não estar deployada no Supabase.

**Como verificar**:
```bash
# Listar funções deployadas
supabase functions list

# Verificar se create-agent aparece na lista
```

**Como resolver**:
```bash
# Deploy da função
supabase functions deploy create-agent
```

### 2. Erro 401 vem do cliente Supabase antes de fazer HTTP request

O cliente JavaScript pode estar rejeitando a chamada antes de enviar a requisição HTTP.

**Possíveis razões**:
- Função não existe no projeto
- Permissões incorretas no projeto Supabase
- API key incorreta

### 3. CORS ou configuração de rede

Menos provável, pois outras Edge Functions funcionam.

## Solução Recomendada

### Passo 1: Verificar se a função está deployada

No Supabase Dashboard:
1. Vá para **Edge Functions**
2. Verifique se `create-agent` aparece na lista
3. Se não aparecer, a função não foi deployada

### Passo 2: Deploy da função

Se a função não estiver deployada, execute:

```bash
cd c:\Projetos\wappal-connect
supabase functions deploy create-agent
```

### Passo 3: Verificar após deploy

1. Tente criar um agente novamente via interface
2. Verifique os logs da função no Dashboard
3. Deve aparecer logs de requisição agora

## Comandos Úteis

```bash
# Listar todas as funções deployadas
supabase functions list

# Deploy de uma função específica
supabase functions deploy create-agent

# Ver logs em tempo real
supabase functions logs create-agent --follow

# Testar função localmente
supabase functions serve create-agent
```

## Nota

A função `zapi-webhook` funciona porque provavelmente já foi deployada anteriormente.
