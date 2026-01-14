import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  let userId = 'system';
  let conversation_id: string | undefined, content: string | undefined, senderName: string | undefined;

  try {
    const authHeader = req.headers.get('Authorization');
    const isServiceKey = authHeader?.includes(supabaseServiceKey);

    if (!isServiceKey) {
      if (!authHeader) throw new Error('Não autorizado: Sessão ausente');
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) throw new Error('Sessão expirada ou inválida');
      userId = user.id;
    }

    senderName = 'Atendente G7';
    if (userId !== 'system') {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('name, display_name')
        .eq('id', userId)
        .single();
      if (profile) {
        senderName = profile.display_name || profile.name || 'Atendente G7';
      }
    } else {
      senderName = 'Ana Mônica';
    }

    const json = await req.json();
    let { content, chatId, recipient: inputRecipient, isGroup } = json;
    conversation_id = json.conversation_id;
    const { message_type, media_url, sender_name: overrideSenderName } = json;

    if (inputRecipient && !chatId) chatId = inputRecipient;
    if (overrideSenderName) senderName = overrideSenderName;

    let conv: any = null;
    let recipient = chatId;

    if (conversation_id) {
      const { data: foundConv } = await supabaseAdmin
        .from('conversations')
        .select('*, contacts(*)')
        .eq('id', conversation_id)
        .single();

      conv = foundConv;
      if (!conv) {
        return new Response(JSON.stringify({ error: 'Conversa não localizada no banco', details: { conversation_id } }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const contact = conv.contacts;
      if (!recipient) {
        recipient = conv.chat_id || contact?.chat_lid || contact?.lid || contact?.phone;
      }
    }

    if (!recipient) {
      console.error('[Send Message] Falha: Destinatário não identificado', { conversation_id, chatId });
      return new Response(JSON.stringify({
        error: 'O destinatário não possui um identificador válido (chatId ou conversation_id)',
        code: 'MISSING_RECIPIENT',
        details: { conversation_id, chatId }
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: zapiSettings } = await supabaseAdmin.from('zapi_settings').select('*').limit(1).single();

    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID') || zapiSettings?.zapi_instance_id;
    const token = Deno.env.get('ZAPI_TOKEN') || zapiSettings?.zapi_token;
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') || zapiSettings?.zapi_security_token;

    if (!instanceId || !token) {
      console.error('[Send Message] Erro: Faltam credenciais ZAPI (Instance ou Token)');
      throw new Error('Configurações de WhatsApp incompletas no servidor');
    }

    const formatForZAPI = (id: string, isGrp: boolean): string => {
      if (!id) return id;
      if (id.includes('@')) return id.trim().toLowerCase();
      return isGrp ? `${id.trim()}@g.us` : `${id.trim()}@s.whatsapp.net`;
    };

    const getChatKey = (id: string | null | undefined, isGrp: boolean) => {
      if (!id) return id;
      const clean = id.trim().toLowerCase();
      if (isGrp || clean.endsWith('@g.us')) return clean;

      const numeric = clean.split('@')[0].replace(/\D/g, '');
      if (!numeric) return numeric;

      if (numeric.length === 10 || numeric.length === 11) return '55' + numeric;
      if ((numeric.length === 12 || numeric.length === 13) && numeric.startsWith('55')) return numeric;

      return numeric;
    };

    const formattedRecipient = formatForZAPI(recipient, !!isGroup);
    const chatKey = getChatKey(formattedRecipient, !!isGroup);

    console.log(`[Send Message] Enviando para ${formattedRecipient} (Key: ${chatKey}, original: ${recipient}, isGroup: ${!!isGroup}) via instância ${instanceId}`);

    // Obter conversation_id se não fornecido (fallback lookup por chatKey)
    let finalConvId = conversation_id;
    if (!finalConvId && chatKey) {
      const { data: contact } = await supabaseAdmin.from('contacts')
        .select('id, conversations(id)')
        .eq('chat_key', chatKey)
        .maybeSingle();

      if (contact && contact.conversations && contact.conversations.length > 0) {
        finalConvId = contact.conversations[0].id;
      }
    }

    let finalContent = content;
    let endpoint = '/send-text';
    let body: any = { phone: formattedRecipient };

    if (message_type === 'text' || !message_type) {
      if (userId !== 'system') {
        finalContent = `*${senderName}:*\n${content}`;
      } else {
        finalContent = content;
      }
      body.message = finalContent;
    } else if (message_type === 'image') {
      endpoint = '/send-image';
      body.image = media_url;
      body.caption = content ? `*${senderName}:*\n${content}` : '';
    } else if (message_type === 'audio') {
      endpoint = '/send-audio';
      body.audio = media_url;
    } else if (message_type === 'document' || message_type === 'file') {
      endpoint = '/send-document';
      body.document = media_url;
      body.fileName = 'documento';
    }

    const zapiBaseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (clientToken) headers['Client-Token'] = clientToken;

    const response = await fetch(`${zapiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error('[Z-API Error]', result);
      throw new Error(`Falha Z-API (${response.status}): ${JSON.stringify(result)}`);
    }

    // Salvar registro no banco
    // ATENÇÃO: Salvamos sempre formattedRecipient no chat_id para garantir consistência da thread
    await supabaseAdmin.from('messages').insert({
      conversation_id: finalConvId,
      sender_type: 'agent',
      sender_id: userId === 'system' ? null : userId,
      agent_name: senderName,
      content: content,
      message_type: message_type || 'text',
      media_url,
      sent_at: new Date().toISOString(),
      provider: 'zapi',
      provider_message_id: result.messageId || result.zapiMessageId,
      status: 'sent',
      direction: 'outbound',
      chat_id: formattedRecipient // <--- FIX: Ensure chat_id is never NULL for outbound
    });

    if (finalConvId) { // Use finalConvId here
      if (userId && userId !== 'system') {
        const pauseUntil = new Date(Date.now() + 30 * 60 * 1000);
        await supabaseAdmin.from('conversations').update({
          human_control: true,
          ai_mode: 'OFF',
          ai_paused_until: pauseUntil.toISOString(),
          last_message_at: new Date().toISOString(),
        }).eq('id', finalConvId);
      } else {
        await supabaseAdmin.from('conversations').update({
          last_message_at: new Date().toISOString(),
        }).eq('id', finalConvId);
      }
    }

    return new Response(JSON.stringify({ success: true, messageId: result.messageId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[Send Message Error]', error.message);
    return new Response(JSON.stringify({ error: error.message, details: error }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});