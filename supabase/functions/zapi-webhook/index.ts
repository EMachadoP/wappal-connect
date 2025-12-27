import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    console.log('[Webhook Debug] Payload:', JSON.stringify(payload));

    // 1. Ignorar ACKs e Status (evitar loops e excesso de processamento)
    if (payload.status || payload.ack || !payload.phone) {
      return new Response(JSON.stringify({ success: true, ignored: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isGroup = Boolean(payload.isGroup);
    const fromMe = Boolean(payload.fromMe);
    
    // Identificador estável do chat
    const chatLid = (payload.chatLid || payload.chatId || payload.phone).trim().toLowerCase();
    
    // Telefone limpo (removendo sufixos do WhatsApp)
    const rawPhone = payload.phone.split('@')[0];
    const cleanPhone = isGroup ? null : rawPhone;
    
    // 2. Localizar ou Criar Contato
    let contactId;
    
    // Busca por chat_lid OU phone OU lid
    const { data: contactData } = await supabase
      .from('contacts')
      .select('id')
      .or(`chat_lid.eq.${chatLid},phone.eq.${cleanPhone || 'null'}`)
      .limit(1)
      .maybeSingle();

    if (contactData) {
      contactId = contactData.id;
      // Atualizar nome se veio algo novo
      await supabase.from('contacts').update({
        whatsapp_display_name: payload.senderName || payload.chatName,
        profile_picture_url: payload.senderPhoto || payload.chatPhoto || null
      }).eq('id', contactId);
    } else {
      const { data: newContact, error: cErr } = await supabase
        .from('contacts')
        .insert({
          name: payload.senderName || payload.chatName || rawPhone || "Contato Novo",
          phone: cleanPhone,
          chat_lid: chatLid,
          is_group: isGroup,
          whatsapp_display_name: payload.senderName || payload.chatName,
          profile_picture_url: payload.senderPhoto || payload.chatPhoto || null
        })
        .select('id')
        .single();
        
      if (cErr) throw cErr;
      contactId = newContact.id;
    }

    // 3. Localizar ou Criar Conversa
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, unread_count, status')
      .eq('chat_id', chatLid)
      .limit(1)
      .maybeSingle();

    let conversationId;
    if (conv) {
      conversationId = conv.id;
      const updates: any = {
        last_message_at: new Date().toISOString(),
        unread_count: fromMe ? 0 : (conv.unread_count || 0) + 1,
      };
      
      if (conv.status === 'resolved' && !fromMe) {
        updates.status = 'open';
      }
      
      await supabase.from('conversations').update(updates).eq('id', conversationId);
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactId,
          chat_id: chatLid,
          thread_key: chatLid,
          status: 'open',
          unread_count: fromMe ? 0 : 1,
          last_message_at: new Date().toISOString()
        })
        .select('id')
        .single();
        
      if (convErr) throw convErr;
      conversationId = newConv.id;
    }

    // 4. Extrair Conteúdo (Z-API envia em lugares diferentes dependendo do tipo)
    let content = "";
    if (payload.text?.message) content = payload.text.message;
    else if (payload.message?.text) content = payload.message.text;
    else if (typeof payload.body === 'string') content = payload.body;
    else if (payload.caption) content = payload.caption;
    
    // Fallback visual se for mídia
    if (!content) {
      const typeMap: any = { image: '📷 Imagem', audio: '🎤 Áudio', ptt: '🎤 Áudio', video: '🎥 Vídeo', document: '📄 Documento' };
      content = typeMap[payload.type] || `[Mensagem: ${payload.type}]`;
    }

    // 5. Salvar Mensagem
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'contact',
      sender_name: payload.senderName || null,
      message_type: payload.type === 'ptt' ? 'audio' : (payload.type || 'text'),
      content: content,
      provider: 'zapi',
      provider_message_id: payload.messageId || payload.id,
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl || payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url || null,
    });

    // 6. Resposta automática IA (apenas inbound e não-grupo)
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(e => console.error('AI Error:', e));
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[Webhook Error]', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});