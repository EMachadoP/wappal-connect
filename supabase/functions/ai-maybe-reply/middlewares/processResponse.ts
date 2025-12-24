import { Context, Middleware } from '../types.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const processResponseMiddleware: Middleware = async (ctx, next) => {
  const supabase = createClient(ctx.supabaseUrl, ctx.supabaseServiceKey);

  // Aqui chamamos a lógica de geração de resposta (ai-generate-reply)
  // e o envio via Z-API.
  
  console.log(`[Pipeline] Gerando resposta para: ${ctx.conversationId}`);
  
  const { data: aiResult, error: aiError } = await supabase.functions.invoke('ai-generate-reply', {
    body: {
      conversation_id: ctx.conversationId,
      // Passar contexto adicional conforme necessário
    }
  });

  if (aiError || !aiResult?.text) {
    console.error('Falha ao gerar resposta IA', aiError);
    return;
  }

  ctx.aiResponseText = aiResult.text;

  // Enviar via Z-API
  await supabase.functions.invoke('zapi-send-message', {
    body: {
      conversation_id: ctx.conversationId,
      content: aiResult.text,
      message_type: 'text',
      sender_name: 'Ana Mônica'
    }
  });

  await next();
};