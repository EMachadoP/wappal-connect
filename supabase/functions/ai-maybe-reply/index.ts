import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

// --- TYPES ---
type Message = {
  id: string;
  conversation_id: string;
  content: string | null;
  message_type: string;
  media_url?: string | null;
  sender_type: string;
  sent_at: string;
};

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  chat_lid: string | null;
  tags?: string[] | null;
};

type Conversation = {
  id: string;
  contact_id: string;
  status: 'open' | 'resolved';
  assigned_to?: string | null;
  ai_mode: 'AUTO' | 'COPILOT' | 'OFF';
  human_control: boolean;
  typing_lock_until?: string | null;
};

type Context = {
  conversationId: string;
  conversation?: Conversation;
  contact?: Contact;
  lastMessage?: Message;
  aiResponseText?: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  settings?: any;
};

type Middleware = (ctx: Context, next: () => Promise<void>) => Promise<void>;

// --- ERRORS ---
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

  if (convError || !conv) throw new Error(`Conversa não encontrada`);

  ctx.conversation = conv;
  ctx.contact = conv.contacts;

  const { data: lastMsg } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', ctx.conversationId)
    .eq('sender_type', 'contact')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  ctx.lastMessage = lastMsg;

  const { data: settings } = await supabase
    .from('ai_settings')
    .select('*')
    .limit(1)
    .single();
  
  ctx.settings = settings;
  await next();
};

const checkFilters: Middleware = async (ctx, next) => {
  const { conversation, contact } = ctx;
  if (!conversation) return;

  if (conversation.ai_mode === 'OFF') throw new PipelineAbortError('IA desativada para esta conversa');

  if (conversation.human_control && conversation.typing_lock_until) {
    if (new Date(conversation.typing_lock_until) > new Date()) {
      throw new PipelineAbortError('Controle humano ativo (lock)');
    }
  }

  const tags = contact?.tags || [];
  if (tags.includes('fornecedor')) throw new PipelineAbortError('Mensagem de fornecedor detectada');

  await next();
};

const processResponse: Middleware = async (ctx, next) => {
  const supabase = createClient(ctx.supabaseUrl, ctx.supabaseServiceKey);
  
  console.log(`[Pipeline] Gerando resposta para: ${ctx.conversationId}`);
  
  const { data: aiResult, error: aiError } = await supabase.functions.invoke('ai-generate-reply', {
    body: { conversation_id: ctx.conversationId }
  });

  if (aiError || !aiResult?.text) {
    console.error('Falha ao gerar resposta IA', aiError);
    return;
  }

  ctx.aiResponseText = aiResult.text;

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

// --- PIPELINE ENGINE ---
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

// --- MAIN SERVER ---
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id } = await req.json();
    
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
      return new Response(JSON.stringify({ success: false, reason: error.reason }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.error('[Pipeline Error]', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});