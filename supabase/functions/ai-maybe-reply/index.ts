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
  is_bot?: boolean;
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

/**
 * Carrega os dados necessários para o processamento
 */
const loadInitialData: Middleware = async (ctx, next) => {
  const supabase = createClient(ctx.supabaseUrl, ctx.supabaseServiceKey);
  
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('*, contacts(*)')
    .eq('id', ctx.conversationId)
    .single();

  if (convError || !conv) throw new Error(`Conversa ${ctx.conversationId} não encontrada`);

  ctx.conversation = conv;
  ctx.contact = conv.contacts;

  const { data: lastMsg } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', ctx.conversationId)
    .eq('sender_type', 'contact')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  ctx.lastMessage = lastMsg;

  const { data: settings } = await supabase
    .from('ai_settings')
    .select('*')
    .limit(1)
    .single();
  
  ctx.settings = settings;
  await next();
};

/**
 * Aplica filtros de negócio para decidir se a IA deve responder
 */
const checkFilters: Middleware = async (ctx, next) => {
  const { conversation, contact, lastMessage } = ctx;
  if (!conversation) return;

  // 1. IA desativada
  if (conversation.ai_mode === 'OFF') throw new PipelineAbortError('IA desativada');

  // 2. Controle humano ativo (Lock por tempo)
  if (conversation.human_control && conversation.typing_lock_until) {
    if (new Date(conversation.typing_lock_until) > new Date()) {
      throw new PipelineAbortError('Humano no controle');
    }
  }

  // 3. Fornecedor detectado por tag
  const tags = contact?.tags || [];
  if (tags.includes('fornecedor')) throw new PipelineAbortError('Remetente é fornecedor');

  // 4. Bot detectado (campo is_bot no contato)
  if (contact?.is_bot) throw new PipelineAbortError('Remetente é um bot');

  // 5. Horário Comercial (Verificação simples)
  const hour = new Date().getUTCHours() - 3; // Brasil UTC-3
  if (hour < 8 || hour >= 18) {
    throw new PipelineAbortError('Fora do horário comercial');
  }

  await next();
};

/**
 * Gera a resposta e envia via Z-API
 */
const processResponse: Middleware = async (ctx, next) => {
  const supabase = createClient(ctx.supabaseUrl, ctx.supabaseServiceKey);
  
  console.log(`[Pipeline] Gerando resposta para: ${ctx.conversationId}`);
  
  // Timeout interno para a IA (30s) para não estourar o limite da Edge Function
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const { data: aiResult, error: aiError } = await supabase.functions.invoke('ai-generate-reply', {
      body: { conversation_id: ctx.conversationId }
    });

    clearTimeout(timeoutId);

    if (aiError || !aiResult?.text) {
      console.error('Falha ao gerar resposta IA', aiError);
      return;
    }

    ctx.aiResponseText = aiResult.text;

    // Envio para o Z-API
    await supabase.functions.invoke('zapi-send-message', {
      body: {
        conversation_id: ctx.conversationId,
        content: aiResult.text,
        message_type: 'text',
        sender_name: 'Ana Mônica'
      }
    });

    await next();
  } catch (err) {
    console.error('[Pipeline Response Error]', err);
  }
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
    
    if (!conversation_id) throw new Error('Missing conversation_id');

    const ctx: Context = {
      conversationId: conversation_id,
      supabaseUrl: Deno.env.get('SUPABASE_URL')!,
      supabaseServiceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    };

    // Executa pipeline em ordem
    await executePipeline(ctx, [loadInitialData, checkFilters, processResponse]);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (error instanceof PipelineAbortError) {
      console.log(`[Pipeline Aborted] Reason: ${error.reason}`);
      return new Response(JSON.stringify({ success: false, reason: error.reason }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.error('[Pipeline Critical Error]', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});