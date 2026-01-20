import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { isEmployeeSender } from "../_shared/is-employee.ts";
import { parseAndExtract } from "../_shared/parse.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request): Promise<Response> => {
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

    // --- HELPERS E NORMALIZAÇÃO BLINDADA ---
    const stripPrefix = (s: string) => s.replace(/^(u:|g:)/, '');

    const normalizeGroupJid = (id: string) => {
      let s = (id ?? '').trim().toLowerCase();
      if (!s) return s;
      s = stripPrefix(s);
      s = s.replace(/\s+/g, '');
      const base = s.includes('@') ? s.split('@')[0] : s;
      const base2 = base.endsWith('-group') ? base.slice(0, -'-group'.length) : base;
      return `${base2}@g.us`;
    };

    const onlyDigits = (v?: string | null) => (v ?? "").replace(/\D/g, "");

    function normalizeChatId(raw: string) {
      const v = (raw || "").trim().toLowerCase().replace("@gus", "@g.us");
      const left = v.split("@")[0] || "";

      const looksGroup = v.endsWith("@g.us") || left.includes("-");

      if (looksGroup) {
        return v.endsWith("@g.us") ? v : `${left}@g.us`;
      }

      const digits = left.replace(/\D/g, "");
      if (!digits) return null;

      const br = (digits.length === 10 || digits.length === 11) ? `55${digits}` : digits;
      return `${br}@s.whatsapp.net`;
    }

    function threadKeyFromChatId(chatId: string) {
      return chatId.endsWith("@g.us") ? `g:${chatId}` : `u:${chatId.split("@")[0]}`;
    }

    const fromMeRaw = payload.fromMe;
    const direction = String(payload.direction || '').toLowerCase(); // 'inbound' | 'outbound'

    const fromMe =
      direction === 'outbound' ? true :
        direction === 'inbound' ? false :
          (fromMeRaw === true || fromMeRaw === 1 || fromMeRaw === "true" || fromMeRaw === "1");

    // ✅ IDENTIFICAÇÃO DO INTERLOCUTOR (PATCH DEFINITIVO)
    const rawFrom = payload?.from || payload?.message?.from || payload?.senderPhone || payload?.phone;
    const rawTo = payload?.to || payload?.message?.to || payload?.recipient || payload?.chatId;

    // Se fui eu que mandei (outbound), o interlocutor é o 'to'. Se recebi (inbound), é o 'from'.
    const rawRecipient = fromMe ? rawTo : rawFrom;
    const canonicalChatId = normalizeChatId(rawRecipient);

    if (!canonicalChatId) {
      throw new Error(`Invalid chatId or phone: ${rawRecipient} (fromMe: ${fromMe})`);
    }

    const threadKey = threadKeyFromChatId(canonicalChatId);
    const isGroupChat = canonicalChatId.endsWith("@g.us");

    // ✅ FIX: O chatName agora segue a direção da mensagem
    let chatName: string;
    if (fromMe) {
      chatName = payload.chatName || payload.contact?.name || payload.recipientName ||
        (canonicalChatId.split('@')[0]) || 'Desconhecido';
    } else {
      chatName = payload.senderName || payload.pushName || payload.contact?.name ||
        payload.chatName || 'Desconhecido';
    }

    console.log(`[Webhook] Identity: ${fromMe ? 'OUT' : 'IN'} | Key=${threadKey} | JID=${canonicalChatId}`);

    const providerMsgId = payload.messageId || payload.id || crypto.randomUUID();

    // ✅ 1. IDEMPOTENCY CHECK
    const { data: existingMsg } = await supabase
      .from('messages')
      .select('id, sender_type')
      .eq('provider_message_id', providerMsgId)
      .maybeSingle();

    if (existingMsg) {
      console.log(`[Webhook] Mensagem duplicada ignorada: ${providerMsgId}`);
      return new Response(JSON.stringify({ success: true, duplicated: true }), { headers: corsHeaders });
    }

    // ✅ 2. RESOLVER/ATUALIZAR CONTATO
    const phone = !isGroupChat ? canonicalChatId.split('@')[0] : null;
    const currentLid = (typeof rawRecipient === 'string' && rawRecipient.endsWith('@lid')) ? rawRecipient : null;

    let contactId: string;
    const { data: contactFound } = await supabase.from('contacts')
      .select('id, chat_key, chat_lid')
      .or(`chat_key.eq.${threadKey},chat_key.eq.${threadKey.replace(/^(u:|g:)/, '')},phone.eq.${phone || 'none'},chat_lid.eq.${rawRecipient || 'none'}`)
      .limit(1)
      .maybeSingle();

    if (contactFound) {
      contactId = contactFound.id;
      const updates: any = { updated_at: now };
      if (!contactFound.chat_key.startsWith('u:') && !contactFound.chat_key.startsWith('g:')) {
        updates.chat_key = threadKey;
      }
      if (currentLid && contactFound.chat_lid !== currentLid) updates.chat_lid = currentLid;
      await supabase.from('contacts').update(updates).eq('id', contactId);
    } else {
      const { data: newContact, error: insErr } = await supabase.from('contacts').insert({
        chat_key: threadKey,
        chat_id: canonicalChatId,
        chat_lid: currentLid || canonicalChatId,
        name: chatName,
        is_group: isGroupChat,
        phone,
        updated_at: now
      }).select('id').single();
      if (insErr || !newContact) throw new Error(`Erro ao criar contato: ${insErr?.message}`);
      contactId = newContact.id;
    }

    // ✅ 3. RESOLVER MÍDIA/CONTEÚDO
    let content = payload.text?.message || payload.message?.text || payload.body || payload.caption || "";
    let msgType: "text" | "image" | "video" | "audio" | "document" | "system" = "text";
    const pType = (payload.type || "").toLowerCase();

    if (payload.audio || payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl) msgType = "audio";
    else if (pType.includes("image") || payload.image) msgType = "image";
    else if (pType.includes("video") || payload.video) msgType = "video";
    else if (pType.includes("document") || payload.document) msgType = "document";

    const lastMessagePreview = (content && content.trim()) || `[${msgType}]`;

    // ✅ 4. UPSERT CONVERSA (Foco no chat_id canônico)
    const convPayload: any = {
      chat_id: canonicalChatId,
      thread_key: threadKey,
      contact_id: contactId,
      last_message: lastMessagePreview.slice(0, 500),
      last_message_type: msgType,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'open'
    };

    // Auto-atribuição para outbound de operador
    if (fromMe) {
      const employee = await isEmployeeSender(supabase, payload);
      if (employee.isEmployee && employee.profileId) {
        convPayload.assigned_to = employee.profileId;
      }
    }

    const { data: conv, error: convUpsertErr } = await supabase
      .from('conversations')
      .upsert(convPayload, { onConflict: 'chat_id' })
      .select('id, assigned_to')
      .single();

    if (convUpsertErr || !conv) {
      console.error(`[Webhook] Erro no upsert da conversa: ${convUpsertErr?.message}`);
      throw convUpsertErr || new Error("Falha no upsert da conversa");
    }

    if (!fromMe) await supabase.rpc('increment_unread_count', { conv_id: conv.id });

    // ✅ UPGRADE CONVERSATION: Se a conversa estava em LID mas agora temos Phone, atualiza!
    if (conv && phone) {
      // Recupera a conversa atual para checar se é LID
      const { data: currentConv } = await supabase
        .from('conversations')
        .select('chat_id, thread_key')
        .eq('id', conv.id)
        .single();

      const isCurrentlyLID = !currentConv?.chat_id || currentConv.chat_id.includes('@lid') || currentConv.thread_key.includes('@lid');
      const hasPhoneNow = phone && phone.length >= 10;

      if (isCurrentlyLID && hasPhoneNow) {
        console.log(`[Webhook] 🔄 Upgrading conversation from LID to phone`);

        await supabase
          .from('conversations')
          .update({
            chat_id: `${phone}@s.whatsapp.net`,
            thread_key: `u:${phone}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', conv.id);
      }
    }


    if (!fromMe) await supabase.rpc('increment_unread_count', { conv_id: conv.id });

    // 7. Salvar Mensagem
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
      senderName = senderName || canonicalChatId.split('@')[0];
    }

    const senderPhone = (payload.contact?.phone || payload.phone || canonicalChatId).split('@')[0];

    let msgResult: any = null;
    let msgError: any = null;

    if (!existingMsg) {
      // ✅ Insert simples - já checamos duplicado acima por provider_message_id
      const insertResult = await supabase
        .from("messages")
        .insert({
          conversation_id: conv.id,
          sender_type: fromMe ? "agent" : "contact",
          sender_name: senderName,
          sender_phone: senderPhone,
          message_type: msgType,
          content,
          provider: "zapi",
          provider_message_id: providerMsgId,
          chat_id: canonicalChatId,
          direction: fromMe ? "outbound" : "inbound",
          sent_at: payload.timestamp ? new Date(payload.timestamp).toISOString() : now,
          raw_payload: payload,
          media_url:
            payload.imageUrl || payload.audioUrl || payload.videoUrl || payload.documentUrl ||
            payload.image?.url || payload.audio?.url || payload.video?.url || payload.document?.url ||
            payload.image?.imageUrl || payload.audio?.audioUrl || payload.video?.videoUrl || payload.document?.documentUrl ||
            null,
        })
        .select("id")
        .single();

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
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey
            },
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
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey
            },
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
    if (!fromMe && !isGroupChat && !msgError && msgResult && !existingMsg) {
      // ✅ Só dispara IA para inbound do contato
      if (!msgResult?.id) {
        return new Response(JSON.stringify({ success: true, skipped_ai: "no_message_id" }), { headers: corsHeaders });
      }

      const audioUrl = payload.audioUrl || payload.audio?.url || payload.audio?.audioUrl || payload.document?.documentUrl || "";
      if (msgType === 'audio') {
        await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message_id: msgResult.id, audio_url: audioUrl, conversation_id: conv.id }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/ai-maybe-reply`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ conversation_id: conv.id, initial_message_id: msgResult.id }),
        }).then(async r => {
          const text = await r.text();
          console.log(`[Webhook] ai-maybe-reply result: ${r.status} ${text}`);
          if (!r.ok) {
            await supabase.from('ai_logs').insert({
              conversation_id: conv.id,
              status: 'error',
              error_message: `ai-maybe-reply failed: ${r.status} ${text}`,
              model: 'webhook-handler'
            });
          }
        }).catch(err => console.error('[Webhook] Erro calling ai-maybe-reply:', err));
      }
    }

    if (!fromMe && isGroupChat && !msgError && msgResult && !existingMsg && msgType === 'text') {
      await fetch(`${supabaseUrl}/functions/v1/group-resolution-handler`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey
        },
        body: JSON.stringify({
          message_id: msgResult.id,
          conversation_id: conv.id,
          message_text: content,
          group_id: threadKey || canonicalChatId,
          sender_phone: senderPhone,
          sender_name: senderName || 'Desconhecido'
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('[Webhook Error]', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: corsHeaders });
  }
});
