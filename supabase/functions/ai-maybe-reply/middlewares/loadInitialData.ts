import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Context, Middleware } from '../types.ts';

export const loadInitialDataMiddleware: Middleware = async (ctx, next) => {
  const supabase = createClient(ctx.supabaseUrl, ctx.supabaseServiceKey);
  
  // Carregar conversa e contato
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('*, contacts(*)')
    .eq('id', ctx.conversationId)
    .single();

  if (convError || !conv) throw new Error(`Conversa não encontrada: ${convError?.message}`);

  ctx.conversation = conv;
  ctx.contact = conv.contacts;

  // Carregar última mensagem inbound
  const { data: lastMsg } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', ctx.conversationId)
    .eq('sender_type', 'contact')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  ctx.lastMessage = lastMsg;

  // Carregar configurações globais
  const { data: settings } = await supabase
    .from('ai_settings')
    .select('*')
    .limit(1)
    .single();
  
  ctx.settings = settings;

  await next();
};