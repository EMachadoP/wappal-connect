import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  console.log(`[Z-API WEBHOOK] Request received at ${new Date().toISOString()}`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Log inicial para confirmar recepção
    const payload = await req.json();
    console.log('[Payload Raw]', JSON.stringify(payload));

    // Registrar atividade global para debug visual no painel Admin
    supabase.from('zapi_settings').update({ 
      last_webhook_received_at: new Date().toISOString() 
    }).is('team_id', null).then();

    // Ignorar ACKs (confirmações de leitura/entrega)
    if (payload.status || payload.ack) {
      return new Response(JSON.stringify({ success: true, type: 'ack_ignored' }), { headers: corsHeaders });
    }

    // Identificação básica obrigatória
    const phone = payload.phone || payload.senderPhone || payload.chatId;
    if (!phone) {
      console.error('Falha crítica: Payload sem telefone/ID de chat');
      return new Response(JSON.stringify({ error: 'No identifier' }), { status: 400, headers: corsHeaders });
    }

    const isGroup = Boolean(payload.isGroup);
    const fromMe = Boolean(payload.fromMe);
    const chatLid = (payload.chatLid || payload.chatId || phone).trim().toLowerCase();
    
    // Nome do contato com múltiplos fallbacks
    const contactName = payload.senderName || payload.chatName || payload.pushName || phone.split('@')[0] || "Contato WhatsApp";

    console.log(`[Webhook] Processando mensagem de ${contactName} (${chatLid})`);

    // 2. Upsert do Contato (Garantir que ele existe)
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .upsert({
        chat_lid: chatLid,
        phone: isGroup ? null : phone.split('@')[0],
        name: contactName,
        is_group: isGroup,
        whatsapp_display_name: contactName,
        profile_picture_url: payload.senderPhoto || payload.chatPhoto || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'chat_lid' })
      .select('id')
      .single();

    if (contactError) {
      console.error('Erro ao salvar contato:', contactError);
      // Tentativa de busca se o upsert falhar por RLS ou constraint
      const { data: existing } = await supabase.from('contacts').select('id').eq('chat_lid', chatLid).maybeSingle();
      if (!existing) throw new Error('Não foi possível criar nem achar o contato');
      var contactId = existing.id;
    } else {
      var contactId = contact.id;
    }

    // 3. Upsert da Conversa (Garantir que existe uma thread)
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .upsert({
        contact_id: contactId,
        chat_id: chatLid,
        thread_key: chatLid,
        status: 'open',
        last_message_at: new Date().toISOString()
      }, { onConflict: 'chat_id' })
      .select('id, unread_count, status')
      .single();

    if (convError) {
      console.error('Erro ao salvar conversa:', convError);
      throw convError;
    }

    // Atualizar contador de não lidas se não for mensagem minha
    if (!fromMe) {
      await supabase.rpc('increment_unread_count', { conv_id: conv.id });
    }

    // 4. Extrair Conteúdo de forma robusta
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";
    
    if (!content && payload.type) {
      const typeLabels: any = { image: '📷 Imagem', audio: '🎤 Áudio', ptt: '🎤 Áudio', video: '🎥 Vídeo', document: '📄 Documento' };
      content = typeLabels[payload.type] || `[Mensagem: ${payload.type}]`;
    }

    // 5. Inserir Mensagem
    const { error: msgError } = await supabase.from('messages').insert({
      conversation_id: conv.id,
      sender_type: fromMe ? 'agent' : 'contact',
      sender_name: payload.senderName || contactName,
      message_type: (payload.type === 'ptt' ? 'audio' : (payload.type || 'text')),
      content: content || "Mensagem sem texto",
      provider: 'zapi',
      provider_message_id: payload.messageId || payload.id || crypto.randomUUID(),
      chat_id: chatLid,
      direction: fromMe ? 'outbound' : 'inbound',
      sent_at: new Date().toISOString(),
      media_url: payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl || payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url || null,
    });

    if (msgError) console.error('Erro ao inserir mensagem:', msgError);

    // 6. Resposta IA (async)
    if (!fromMe && !isGroup) {
      fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ conversation_id: conv.id }),
      }).catch(e => console.error('Falha ao disparar IA:', e));
    }

    return new Response(JSON.stringify({ success: true, message: 'Salvo com sucesso' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[Webook Fatal Error]', error.message);
    // Retornar 200 mesmo no erro para o Z-API não suspender o webhook
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});