import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let conversation_id: string | null = null;
  let lockToken: string | null = null;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function getLatestInboundMessageId(supabase: any, conversationId: string) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, sent_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.id ?? null;
  }

  async function getLatestAssistantMessageSentAt(supabase: any, conversationId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from("messages")
      .select("sent_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .eq("sender_type", "assistant")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return data?.sent_at ?? null;
  }

  function isInternalOpsText(text: string) {
    const t = (text || "").toLowerCase();
    return (
      t.includes("criar agendamento:") ||
      t.includes("operador (celular)") ||
      t.includes("para eu abrir o chamado") ||
      t.includes("me envie assim:") ||
      t.includes("exemplo:")
    );
  }

  // -----------------------------
  // AI Logs - padronizado
  // -----------------------------
  async function logAiSkip(
    supabase: any,
    convId: string,
    opts: {
      status: "skipped" | "ok" | "error";
      skip_reason?: "locked" | "debounced" | "paused" | "role_blocked" | "unknown";
      error_message?: string;
      model?: string;
      meta?: any;
    }
  ) {
    try {
      await supabase.from("ai_logs").insert({
        conversation_id: convId,
        status: opts.status,
        skip_reason: opts.skip_reason ?? null,
        error_message: opts.error_message ?? null,
        model: opts.model ?? "ai-maybe-reply",
        meta: opts.meta ?? null,
      });
    } catch (e) {
      console.warn("[ai_logs] insert failed", e);
    }
  }

  // -----------------------------
  // RPC Locking (V11) - atômico no Postgres clock
  // -----------------------------
  async function acquireLockRpc(supabase: any, convId: string, ttlSeconds = 60) {
    const { data, error } = await supabase.rpc("acquire_conversation_lock", {
      p_conversation_id: convId,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      ok: !!row?.ok,
      token: row?.token ?? null,
      until: row?.until ?? null
    };
  }

  async function releaseLockRpc(supabase: any, convId: string, token: string) {
    const { data, error } = await supabase.rpc("release_conversation_lock", {
      p_conversation_id: convId,
      p_token: token,
    });
    if (error) {
      console.warn("[lock] release rpc failed", error);
      return false;
    }
    return !!data;
  }

  try {
    const body = await req.json();
    conversation_id = body.conversation_id;
    const { initial_message_id } = body;

    if (!conversation_id) {
      return new Response(JSON.stringify({ ok: false, error: "missing conversation_id" }), { status: 400 });
    }

    // ✅ Lock no worker (não no webhook) - via RPC V11
    const lock = await acquireLockRpc(supabase, conversation_id, 60);
    if (!lock.ok) {
      console.log("[ai-maybe-reply] Concurrency Limit: locked", { conversation_id });
      await logAiSkip(supabase, conversation_id, {
        status: "skipped",
        skip_reason: "locked",
        error_message: "Concurrency Limit: locked"
      });
      return new Response(JSON.stringify({ ok: true, skipped: "locked" }), { status: 200, headers: corsHeaders });
    }
    lockToken = lock.token;

    try {
      // ---- DEBOUNCE RESILIENTE (não aborta, re-debounce) ----
      const MAX_LOOPS = 4;
      const DEBOUNCE_MS = 4000;

      let latestId = await getLatestInboundMessageId(supabase, conversation_id);
      if (!latestId) {
        console.log("[ai-maybe-reply] Sem msg inbound. Saindo.");
        return new Response(JSON.stringify({ ok: true, skipped: "no_inbound" }), { status: 200, headers: corsHeaders });
      }

      for (let i = 1; i <= MAX_LOOPS; i++) {
        console.log(`[ai-maybe-reply] Debounce loop ${i}/${MAX_LOOPS}. Msg inicial: ${latestId}`);

        await sleep(DEBOUNCE_MS);

        const afterWait = await getLatestInboundMessageId(supabase, conversation_id);

        if (afterWait && afterWait !== latestId) {
          console.log(`[ai-maybe-reply] Debounce: Nova msg durante janela. Reiniciando. { before: "${latestId}", now: "${afterWait}" }`);
          latestId = afterWait;
          continue; // NÃO aborta. Recomeça o debounce aqui mesmo.
        }

        console.log("[ai-maybe-reply] Debounce: Estabilizou. Seguindo para geração.");
        break;
      }

      console.log("[ai-maybe-reply] 🚀 Debounce finalizado. Verificando resposta recente...");

      // ✅ SOLUÇÃO 2: Verificar se já respondeu recentemente (últimos 7 seg)
      const lastAssistantAt = await getLatestAssistantMessageSentAt(supabase, conversation_id);
      if (lastAssistantAt) {
        const diff = Date.now() - new Date(lastAssistantAt).getTime();
        if (diff < 7000) {
          console.log("[ai-maybe-reply] ✋ Skip: IA já respondeu recentemente.", { diff_ms: diff });
          await logAiSkip(supabase, conversation_id, {
            status: "skipped",
            skip_reason: "debounced",
            error_message: "Recent assistant reply detected"
          });
          return new Response(JSON.stringify({ ok: true, skipped: "recent_reply" }), { status: 200, headers: corsHeaders });
        }
      }

      // 2. Carregar dados da conversa e configurações
      const { data: conv } = await supabase
        .from('conversations')
        .select('*, contacts(*)')
        .eq('id', conversation_id)
        .single();

      if (!conv) {
        console.log('[ai-maybe-reply] Conversa não encontrada:', conversation_id);
        return new Response(JSON.stringify({ success: false, reason: 'Conversa não encontrada' }));
      }

      // 3. Checar papel do participante (antes de verificar ai_mode)
      const { data: participantState } = await supabase
        .from('conversation_participant_state')
        .select('current_participant_id, participants(name, role_type, entity_id, entities(name, type))')
        .eq('conversation_id', conversation_id)
        .maybeSingle();

      // LOG DETALHADO: Estado da conversa após debounce
      console.log('[ai-maybe-reply] Estado da conversa:', {
        conversation_id,
        ai_mode: conv.ai_mode,
        participant_role: participantState?.participants?.role_type,
        participant_name: participantState?.participants?.name,
        has_participant: !!participantState?.participants,
        ai_paused_until: conv.ai_paused_until
      });

      // ✅ FIX: Respect Option B (Manual Pause with AI_MODE=AUTO)
      if (conv.ai_paused_until) {
        const pausedUntil = new Date(conv.ai_paused_until).getTime();
        if (!Number.isNaN(pausedUntil) && pausedUntil > Date.now()) {
          console.log('[ai-maybe-reply] ⏸️ AI paused temporarily until', conv.ai_paused_until);
          await logAiSkip(supabase, conversation_id, {
            status: 'skipped',
            skip_reason: 'paused',
            error_message: 'AI temporarily paused'
          });
          return new Response(JSON.stringify({ success: false, reason: 'AI Temporarily Paused' }));
        }
      }

      // ✅ REVERT: Auto-reactivate AI when pause expires (restore original behavior)
      if (conv.ai_mode === 'OFF' && conv.ai_paused_until) {
        const pausedUntil = new Date(conv.ai_paused_until).getTime();
        if (!Number.isNaN(pausedUntil) && Date.now() >= pausedUntil) {
          console.log("[ai-maybe-reply] Pause expired. Re-enabling AI.", { conversation_id });
          await supabase.from("conversations").update({
            ai_mode: "AUTO",
            human_control: false,
            ai_paused_until: null,
          }).eq("id", conversation_id);

          // Update local ref for rest of this invocation
          conv.ai_mode = "AUTO";
          conv.human_control = false;
          conv.ai_paused_until = null;
        }
      }

      if (conv.ai_mode === 'OFF') {
        console.log('[ai-maybe-reply] IA está desligada (OFF) para esta conversa.');
        await logAiSkip(supabase, conversation_id, {
          status: 'skipped',
          skip_reason: 'paused',
          error_message: 'IA mode is OFF'
        });
        return new Response(JSON.stringify({ success: false, reason: 'IA OFF' }));
      }

      // 4. Verificação RIGOROSA do papel de fornecedor
      if (participantState?.participants) {
        const participant = participantState.participants as any;
        console.log('[ai-maybe-reply] Verificando papel do participante:', {
          role_type: participant.role_type,
          name: participant.name,
          entity_id: participant.entity_id
        });

        // IMPORTANTE: Só bloqueia se for REALMENTE fornecedor ou funcionario
        if (participant.role_type === 'fornecedor' || participant.role_type === 'funcionario') {
          console.log(`[ai-maybe-reply] ⛔ Bloqueando: ${participant.role_type} confirmado`);
          await logAiSkip(supabase, conversation_id, {
            status: 'skipped',
            skip_reason: 'role_blocked',
            error_message: `Blocked by role: ${participant.role_type}`,
            meta: { participant_name: participant.name }
          });
          return new Response(JSON.stringify({
            success: false,
            reason: `Role: ${participant.role_type}`
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } else {
          console.log('[ai-maybe-reply] ✅ Role permitido:', participant.role_type);
        }
      } else {
        console.log('[ai-maybe-reply] ⚠️ Nenhum participante identificado ainda');
      }

      // 4. Buscar histórico de mensagens (AUMENTADO PARA MELHOR CONTEXTO)
      const TAKE_LAST = 30; // ✅ Aumentado de 10 para 30 para evitar "perguntas bobas"

      const { data: msgs, error: msgsErr } = await supabase
        .from('messages')
        .select('content, transcript, sender_type, message_type, sent_at')
        .eq('conversation_id', conversation_id)
        .order('sent_at', { ascending: false })
        .limit(TAKE_LAST);

      if (msgsErr) {
        console.error('[ai-maybe-reply] Erro ao buscar mensagens:', msgsErr);
        throw msgsErr;
      }

      const messages = (msgs || [])
        .map((m) => {
          const text = (m.transcript || m.content || '').trim();
          if (!text || text === '...' || text.startsWith('[Mídia:') || text.startsWith('[Arquivo:')) {
            return null;
          }
          const sender = (m.sender_type || '').toLowerCase();
          const role = sender === 'contact' ? 'user' : 'assistant';
          return { role, content: text };
        })
        .filter(Boolean)
        .reverse() as { role: string; content: string }[];

      console.log(`[ai-maybe-reply] Carregadas ${messages.length} mensagens úteis de ${msgs?.length || 0} totais`);

      // 5. Buscar prompt e configurações globais
      const { data: settings } = await supabase.from('ai_settings').select('*').maybeSingle();
      let systemPrompt = settings?.base_system_prompt || "Você é um assistente virtual.";
      let contextInfo = '';

      if (participantState?.participants) {
        const participant = participantState.participants as any;
        const roleLabels: Record<string, string> = {
          'sindico': 'Síndico', 'subsindico': 'Subsíndico', 'porteiro': 'Porteiro', 'zelador': 'Zelador', 'morador': 'Morador',
          'administrador': 'Administrador', 'conselheiro': 'Conselheiro', 'funcionario': 'Funcionário', 'supervisor_condominial': 'Supervisor Condominial',
          'visitante': 'Visitante', 'prestador': 'Prestador de Serviço', 'fornecedor': 'Fornecedor', 'outro': 'Outro'
        };
        const roleLabel = roleLabels[participant.role_type] || participant.role_type;
        const entityName = participant.entities?.name || 'não especificado';
        const entityType = participant.entities?.type || 'condominio';
        const entityTypeLabels: Record<string, string> = { 'empresa': 'Empresa', 'administradora': 'Administradora', 'condominio': 'Condomínio', 'prestador': 'Prestador' };
        const entityTypeLabel = entityTypeLabels[entityType] || 'Entidade';

        contextInfo += `\n👤 Nome: ${participant.name}\n💼 Função: ${roleLabel}\n🏢 ${entityTypeLabel}: ${entityName}\n`;
        contextInfo += `\n⚠️ NUNCA pergunte nome, função ou entidade - você JÁ SABE.\n`;
      }

      const now = new Date();
      const currentTimeStr = new Intl.DateTimeFormat('pt-BR', { timeZone: settings?.timezone || 'America/Recife', dateStyle: 'full', timeStyle: 'medium' }).format(now);
      systemPrompt = systemPrompt.replace(/{{customer_name}}/g, conv.contacts?.name || 'Cliente').replace(/{{current_time}}/g, currentTimeStr) + contextInfo;

      // 6. Gerar resposta
      console.log('[ai-maybe-reply] Chamando geração...');
      const aiResponse = await fetch(`${supabaseUrl}/functions/v1/ai-generate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}`, 'apikey': supabaseServiceKey },
        body: JSON.stringify({ messages, systemPrompt, conversation_id, participant_id: participantState?.current_participant_id }),
      });

      if (!aiResponse.ok) throw new Error(`ai-generate-reply failed: ${aiResponse.status}`);
      const aiData = await aiResponse.json();
      let text = (aiData?.text ?? "Em que posso ajudar hoje?").toString().trim();

      // 7. Enviar via Z-API
      const idempotencyKey = `ai_${conversation_id}_${latestId || 'unknown'}`;

      if (isInternalOpsText(text)) {
        console.log("[safety] blocked internal ops text leak", { text });
        text = "Entendido! Vou encaminhar internamente e já retorno por aqui.";
      }

      await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}`, 'apikey': supabaseServiceKey },
        body: JSON.stringify({ conversation_id, content: text, message_type: 'text', sender_name: 'Ana Mônica', is_system: true, idempotency_key: idempotencyKey }),
      });

      console.log('[ai-maybe-reply] ✅ Mensagem enviada com sucesso');
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } finally {
      if (lockToken && conversation_id) {
        await releaseLockRpc(supabase, conversation_id, lockToken);
      }
    }
  } catch (e: any) {
    console.error("[ai-maybe-reply] Unhandled error", e);
    try {
      if (typeof conversation_id === "string" && conversation_id) {
        await logAiSkip(supabase, conversation_id, {
          status: "error",
          skip_reason: "unknown",
          error_message: String(e?.message ?? e)
        });
      }
    } catch (_) { }
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});