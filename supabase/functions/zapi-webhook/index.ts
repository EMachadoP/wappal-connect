import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isEmployeeSender } from "../_shared/employee.ts";
import { parseAndExtract } from "../_shared/parse.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const now = new Date().toISOString();
  let payload: any;

  try {
    payload = await req.json();
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- LOG DE DEPURAÇÃO (ai_logs) ---
    await supabase.from('ai_logs').insert({
      status: 'webhook_received',
      input_excerpt: JSON.stringify(payload).substring(0, 1000),
      model: 'webhook-debug',
      provider: 'zapi',
      created_at: now
    });

    // 1. Obter configurações
    const { data: settings } = await supabase.from('zapi_settings')
      .select('forward_webhook_url')
      .is('team_id', null)
      .maybeSingle();

    await supabase.from('zapi_settings')
      .update({ last_webhook_received_at: now })
      .is('team_id', null);

    // 2. ENCAMINHAMENTO
    if (settings?.forward_webhook_url) {
      fetch(settings.forward_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error('[Forward Error]', err));
    }

    // 3. Ignorar status updates puros
    const isStatusUpdate = Boolean(payload.ack || payload.type === 'chatState' || (payload.status && !payload.text && !payload.message && !payload.image && !payload.video && !payload.audio && !payload.document));
    if (isStatusUpdate) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

    // --- IDENTIFICAÇÃO E NORMALIZAÇÃO ---
    const isGroup = Boolean(payload.isGroup || (payload.chatLid && payload.chatLid.includes('@g.us')) || (payload.chatId && payload.chatId.includes('@g.us')));
    const fromMe = Boolean(payload.fromMe);

    // CHAT_KEY: O identificador canônico (numérico para pessoas, id original para grupos)
    // Regras BR: 10/11 dígitos -> prefixa 55. 12/13 com 55 -> mantém.
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

    const normalizeLid = (id: string | null | undefined) => {
      if (!id) return id;
      let normalized = id.trim().toLowerCase();
      if (normalized.endsWith('@lid') || normalized.endsWith('@g.us')) return normalized;
      if (normalized.includes('@')) normalized = normalized.split('@')[0];
      return normalized;
    };

    let chatLid = normalizeLid(payload.chatLid || payload.chatId || payload.chat?.chatId || payload.phone || payload.senderPhone);
    const contactLid = normalizeLid(payload.contact?.lid || payload.lid || payload.participantLid || (isGroup ? null : chatLid) || payload.senderPhone || payload.phone);

    if (!chatLid && contactLid && !isGroup) chatLid = contactLid;
    if (!contactLid || !chatLid) throw new Error(`Identificadores ausentes: contact=${contactLid}, chat=${chatLid}`);

    const chatIdentifier = isGroup ? chatLid : contactLid;
    const chatKey = getChatKey(chatIdentifier, !!isGroup);
    const chatName = payload.chatName || payload.contact?.name || payload.senderName || payload.pushName || (chatIdentifier ? chatIdentifier.split('@')[0] : 'Desconhecido');

    const providerMsgId = payload.messageId || payload.id || crypto.randomUUID();

    // IDEMPOTÊNCIA: Ignorar se a mensagem já existe
    const { data: existingMsg } = await supabase
      .from('messages')
      .select('id')
      .eq('provider_message_id', providerMsgId)
      .maybeSingle();

    if (existingMsg) {
      console.log(`[Webhook] Mensagem duplicada ignorada: ${providerMsgId}`);
      return new Response(JSON.stringify({ success: true, duplicated: true }), { headers: corsHeaders });
    }

    console.log(`[Webhook] Normalizing: ID=${chatIdentifier} -> Key=${chatKey} (Group: ${!!isGroup})`);

    // 4. Salvar/Atualizar Contato usando CHAT_KEY
    let contactId: string;
    const { data: existingContact } = await supabase.from('contacts')
      .select('id, chat_lid, phone, name')
      .eq('chat_key', chatKey)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      // Atualizar dados se vierem novos (ex: nome, lid caso ainda não tenha)
      const updates: any = { updated_at: now };
      if (!existingContact.chat_lid && chatIdentifier.includes('@')) updates.chat_lid = chatIdentifier;
      if (!existingContact.phone && !isGroup && !chatIdentifier.includes('@')) updates.phone = chatIdentifier;

      await supabase.from('contacts').update(updates).eq('id', contactId);
    } else {
      const { data: newContact, error: insertError } = await supabase.from('contacts').insert({
        chat_key: chatKey,
        chat_lid: chatIdentifier,
        lid: chatIdentifier,
        name: chatName,
        is_group: isGroup,
        phone: !isGroup && !chatIdentifier.includes('@') ? chatIdentifier : null,
        updated_at: now
      }).select('id').single();

      if (insertError || !newContact) throw new Error(`Falha ao criar contato: ${insertError?.message}`);
      contactId = newContact.id;
    }

    // 5. Salvar/Atualizar Conversa
    let { data: existingConv } = await supabase.from('conversations')
      .select('id, active_condominium_id')
      .eq('contact_id', contactId)
      .maybeSingle();

    // Auto-Condominium Selection
    let autoCondoId: string | null = null;
    if (!existingConv?.active_condominium_id) {
      const { data: linkedCondos } = await supabase
        .from('contact_condominiums')
        .select('condominium_id, is_default')
        .eq('contact_id', contactId);

      if (linkedCondos && linkedCondos.length > 0) {
        const defaultCondo = linkedCondos.find(lc => lc.is_default);
        autoCondoId = defaultCondo?.condominium_id || (linkedCondos.length === 1 ? linkedCondos[0].condominium_id : null);
      }
    }

    let conv: { id: string };

    if (existingConv) {
      const updateData: any = {
        last_message_at: now,
        chat_id: chatLid, // Atualizamos o chat_id na conversa para o mais recente (@lid ou normal)
        status: 'open'
      };

      if (autoCondoId) {
        updateData.active_condominium_id = autoCondoId;
        updateData.active_condominium_set_by = 'human';
        updateData.active_condominium_set_at = now;
      }

      const { data: updated, error: updateErr } = await supabase.from('conversations')
        .update(updateData)
        .eq('id', existingConv.id)
        .select('id')
        .single();

      if (updateErr || !updated) throw new Error(`Erro ao atualizar conversa: ${updateErr?.message}`);
      conv = updated;
    } else {
      const insertData: any = {
        contact_id: contactId,
        chat_id: chatLid,
        thread_key: chatKey, // Thread key agora baseada na chave canônica
        status: 'open',
        last_message_at: now
      };

      if (autoCondoId) {
        insertData.active_condominium_id = autoCondoId;
        insertData.active_condominium_set_by = 'human';
        insertData.active_condominium_set_at = now;
      }

      const { data: created, error: createErr } = await supabase.from('conversations')
        .upsert(insertData, { onConflict: 'thread_key' })
        .select('id')
        .single();

      if (createErr || !created) throw new Error(`Erro ao criar conversa: ${createErr?.message}`);
      conv = created;
    }

    if (!fromMe) await supabase.rpc('increment_unread_count', { conv_id: conv.id });

    // 6. Salvar Mensagem
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";
    let msgType: "text" | "image" | "video" | "audio" | "document" | "system" = "text";
    const pType = (payload.type || "").toLowerCase();

    if (payload.audio || payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl) msgType = "audio";
    else if (payload.image || payload.imageUrl || payload.image?.url || payload.image?.imageUrl) msgType = "image";
    else if (payload.video || payload.videoUrl || payload.video?.url || payload.video?.videoUrl) msgType = "video";
    else if (payload.document || payload.documentUrl || payload.document?.url || payload.document?.documentUrl) msgType = "document";
    else if (pType === "audio" || pType === "ptt" || pType === "voice") msgType = "audio";
    else if (pType === "image") msgType = "image";
    else if (pType === "video") msgType = "video";
    else if (pType === "document") msgType = "document";

    if (!content && msgType !== "text") {
      const fileName = payload.fileName || payload.document?.fileName || payload.image?.fileName || "";
      content = fileName ? `[Arquivo: ${fileName}]` : `[Mídia: ${msgType}]`;
    }
    if (!content) content = "...";

    let senderName = payload.senderName || payload.pushName;
    if (!fromMe && !senderName) senderName = payload.contact?.name;
    if (fromMe && (!senderName || /^\d+$/.test(senderName.replace(/\D/g, '')))) {
      senderName = "Operador (Celular)";
    } else if (!fromMe) {
      senderName = senderName || chatIdentifier.split('@')[0];
    }

    const senderPhone = (payload.contact?.phone || payload.phone || contactLid).split('@')[0];

    let msgResult = null;
    let msgError = null;

    if (!existingMsg) {
      const insertResult = await supabase.from('messages').insert({
        conversation_id: conv.id,
        sender_type: fromMe ? 'agent' : 'contact',
        sender_name: senderName,
        sender_phone: senderPhone,
        message_type: msgType,
        content: content,
        provider: 'zapi',
        provider_message_id: providerMsgId,
        chat_id: chatLid, // Aqui salvamos o chat_id bruto do webhook
        direction: fromMe ? 'outbound' : 'inbound',
        sent_at: now,
        raw_payload: payload,
        media_url: payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl ||
          payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url ||
          payload.image?.imageUrl || payload.audio?.audioUrl || payload.video?.videoUrl || payload.document?.documentUrl ||
          null,
      }).select('id').single();

      msgResult = insertResult.data;
      msgError = insertResult.error;
    }

    if (msgError) throw new Error(`Falha ao salvar mensagem: ${msgError.message}`);

    // Command Detection & Media Storage follows...
    if (!fromMe && msgResult?.id && msgType === 'text') {
      const employee = await isEmployeeSender(supabase, payload);
      if (employee.isEmployee) {
        const parsed = parseAndExtract(content);
        if (parsed.intent === 'needs_more_info') {
          // Send help message...
          await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversation_id: conv.id,
              content: `📋 Oi, ${employee.profileName}!\n\n${parsed.hint}`,
              message_type: 'text',
              sender_name: 'Sistema'
            })
          });
          return new Response(JSON.stringify({ success: true, needs_more_info: true }), { headers: corsHeaders });
        }
        if (parsed.intent === 'create_protocol') {
          await fetch(`${supabaseUrl}/functions/v1/create-protocol`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversation_id: conv.id,
              condominium_name: parsed.condominiumName,
              summary: parsed.summary,
              priority: parsed.priority || 'normal',
              category: parsed.category || 'operational',
              requester_name: `G7 Serv (${employee.profileName})`,
              requester_role: 'Funcionário',
              created_by_agent_id: employee.profileId,
              created_by_type: 'agent',
              force_new: parsed.forceNew ?? true,
              notify_group: true,
              notify_client: false,
              source_message_id: msgResult.id
            })
          });
          return new Response(JSON.stringify({ success: true, employee_command: true }), { headers: corsHeaders });
        }
      }
    }

    // Media Storage...
    if (msgResult && (msgType === 'audio' || msgType === 'video')) {
      // Cloud storage logic...
    }

    // AI & Group Resolution...
    if (!fromMe && !isGroup && !msgError && msgResult && !existingMsg) {
      const audioUrl = payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl || payload.document?.documentUrl || "";
      if (msgType === 'audio') {
        await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_id: msgResult.id, audio_url: audioUrl, conversation_id: conv.id }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: conv.id }),
        });
      }
    }

    if (!fromMe && isGroup && !msgError && msgResult && !existingMsg && msgType === 'text') {
      await fetch(`${supabaseUrl}/functions/v1/group-resolution-handler`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: msgResult.id, conversation_id: conv.id, message_text: content, sender_phone: contactLid, sender_name: senderName || 'Desconhecido' }),
      });
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('[Webhook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: corsHeaders });
  }
});
