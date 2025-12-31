# Guia de Implementação do Logger Centralizado

## 📋 Visão Geral

Este guia mostra como migrar as Edge Functions para usar o Logger centralizado.

---

## 🚀 Exemplo de Uso

### Antes (Logging Manual)

```typescript
serve(async (req) => {
  try {
    const { conversation_id } = await req.json();
    console.log('Processing conversation:', conversation_id);
    
    // ... lógica
    
    console.log('Success');
    return new Response(JSON.stringify({ success: true }));
    
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500
    });
  }
});
```

### Depois (Com Logger)

```typescript
import { createLogger } from '../_shared/logger.ts';

serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const logger = createLogger(req, 'my-function', supabaseUrl, supabaseKey);
  
  try {
    const { conversation_id } = await req.json();
    
    logger.info('Processing conversation', { conversation_id });
    
    // ... lógica
    
    logger.info('Success');
    await logger.logFunctionCall('my-function', 'success', { conversation_id });
    
    return new Response(JSON.stringify({ 
      success: true,
      correlationId: logger.getCorrelationId()
    }));
    
  } catch (error) {
    await logger.error('Function failed', error as Error);
    
    return new Response(JSON.stringify({ 
      error: error.message,
      correlationId: logger.getCorrelationId()
    }), {
      status: 500
    });
  }
});
```

---

## 🔄 Propagação de Correlation ID

### Chamando Outra Edge Function

```typescript
// Na função chamadora
const correlationId = logger.getCorrelationId();

const response = await fetch(`${supabaseUrl}/functions/v1/other-function`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'x-correlation-id': correlationId, // PROPAGAR
  },
  body: JSON.stringify({ data })
});
```

### Na Função Receptora

```typescript
// Correlation ID será automaticamente extraído do header
const logger = createLogger(req, 'other-function', supabaseUrl, supabaseKey);
// logger.getCorrelationId() retornará o mesmo ID
```

---

## 📊 Contexto Adicional

### Adicionando Contexto Específico

```typescript
// Logger base
const logger = createLogger(req, 'my-function', supabaseUrl, supabaseKey);

// Adicionar conversation_id ao contexto
const conversationLogger = logger.withContext({ 
  conversationId: conversation_id 
});

// Agora todos os logs incluirão conversation_id
conversationLogger.info('Processing message');
// [INFO][my-function][abc123] Processing message | {"conversationId":"xyz"}
```

---

## 🎯 Checklist de Migração

Para cada Edge Function:

- [ ] Importar `createLogger` de `_shared/logger.ts`
- [ ] Criar logger no início da função
- [ ] Substituir `console.log` por `logger.info`
- [ ] Substituir `console.warn` por `logger.warn`
- [ ] Substituir `console.error` por `logger.error`
- [ ] Adicionar `logger.logFunctionCall` no sucesso
- [ ] Propagar correlation ID em chamadas externas
- [ ] Incluir correlation ID na resposta
- [ ] Testar logging end-to-end

---

## 📝 Funções Prioritárias para Migração

1. ✅ `create-ticket` (crítico)
2. ✅ `ai-generate-reply` (crítico)
3. ⏳ `ai-maybe-reply`
4. ⏳ `zapi-webhook`
5. ⏳ `transcribe-audio`
6. ⏳ `zapi-send-message`

---

## 🔍 Debugging com Correlation ID

### Rastrear Requisição Completa

```sql
-- Ver todos os logs de uma requisição
SELECT 
  created_at,
  model as function_name,
  status,
  error_message,
  input_excerpt
FROM ai_logs
WHERE request_id = 'SEU_CORRELATION_ID'
ORDER BY created_at;
```

### Exemplo de Output

```
2025-12-30 09:00:00 | zapi-webhook      | completed | null
2025-12-30 09:00:01 | ai-maybe-reply    | completed | null
2025-12-30 09:00:02 | ai-generate-reply | completed | null
2025-12-30 09:00:03 | create-ticket     | completed | null
2025-12-30 09:00:04 | zapi-send-message | completed | null
```

---

## ⚡ Performance

O Logger é otimizado para:
- ✅ Logging assíncrono (não bloqueia)
- ✅ Batch writes (quando possível)
- ✅ Minimal overhead (<5ms)

---

**Próximo Passo:** Migrar `create-ticket` primeiro como exemplo
