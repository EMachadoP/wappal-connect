import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

// --- TIPOS ---
type Contact = {
  id: string;
  name: string;
  tags?: string[] | null;
};

type Conversation = {
  id: string;
  ai_mode: 'AUTO' | 'COPILOT' | 'OFF';
  human_control: boolean;
  typing_lock_until?: string | null;
};

type Context = {
  conversationId: string;
  conversation?: Conversation;
  contact?: Contact;
  supabaseUrl: string;
  supabaseServiceKey: string;
};

type Middleware = (ctx: Context, next: () => Promise<void>) => Promise<void>;

// --- ERROS ---
class PipelineAbortError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = 'PipelineAbortError';
  }
}

// --- MIDDLEWARES ---

const loadInitialData: Middleware = async (ctx, next) => {
  const supabase = createClient(ctx.supabaseUrl, ctx.supabaseServiceKey);
  
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('*, contacts(*)')
    .eq('id', ctx.conversationId)
    .single();

  if (convError || !conv) throw new Error(`Conversa não encontrada: ${ctx.conversationId}`);

  ctx.conversation = conv;
  ctx.contact = conv.contacts;

  await next();
};

const checkFilters: Middleware = async (ctx, next) => {
  const { conversation, contact } = ctx;
  if (!conversation) return;

  if (conversation.ai_mode === 'OFF') throw new PipelineAbortError('IA desativada');

  if (conversation.human_control && conversation.typing_lock_until) {
    if (new Date(conversation.typing_lock_until) > new Date()) {
      throw new PipelineAbortError('Humano ativo no momento');
    }
  }

  const tags = contact?.tags || [];
  if (tags.includes('fornecedor')) throw new PipelineAbortError('Remetente identificado como fornecedor');

  await next();
};

const processResponse: Middleware = async (ctx, next) => {
  const supabase = createClient(ctx.supabaseUrl, ctx.supabaseServiceKey);
  
  console.log(`[Pipeline] Gerando resposta para: ${ctx.conversationId}`);
  
  const { data: aiResult, error: aiError } = await supabase.functions.invoke('ai-generate-reply', {
    body: { conversation_id: ctx.conversationId }
  });

  if (aiError || !aiResult?.text) {
    console.error('Falha na geração IA', aiError);
    return;
  }

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

// --- ENGINE ---
async function executePipeline(ctx: Context, middlewares: Middleware[]) {
  let index = 0;
  const next = async (): Promise<void> => {
    if (index < middlewares.length) {
      const middleware = middlewares[index++];
      await middleware(ctx, next);
    }
  };
  await next();
}

// --- SERVIDOR ---
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id } = await req.json();
    if (!conversation_id) throw new Error('ID da conversa é obrigatório');

    const ctx: Context = {
      conversationId: conversation_id,
      supabaseUrl: Deno.env.get('SUPABASE_URL')!,
      supabaseServiceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    };

    await executePipeline(ctx, [loadInitialData, checkFilters, processResponse]);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (error instanceof PipelineAbortError) {
      console.log(`[Pipeline Abortado] ${error.reason}`);
      return new Response(JSON.stringify({ success: false, reason: error.reason }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.error('[Pipeline Erro]', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});