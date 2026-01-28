import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type Message = Database['public']['Tables']['messages']['Row'];

export function useRealtimeMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const channelRef = useRef<any>(null);

  const PAGE_SIZE = 50;
  const fetchSeq = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  const oldestSentAtRef = useRef<string | null>(null);

  const fetchMessages = useCallback(async (id: string) => {
    const seq = ++fetchSeq.current;
    activeIdRef.current = id;

    console.log(`[RealtimeMessages] Fetching messages for: ${id}`);
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('sent_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      // ✅ ignora resultado velho (out-of-order)
      if (seq !== fetchSeq.current) return;
      if (activeIdRef.current !== id) return;

      const ordered = (data ?? []).reverse();
      setMessages(ordered);

      // paginação
      oldestSentAtRef.current = ordered.length ? ordered[0].sent_at : null;
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch (err) {
      console.error('[RealtimeMessages] Error fetching:', err);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, []);

  const loadMoreMessages = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    if (loadingMore) return;
    if (!hasMore) return;

    const before = oldestSentAtRef.current;
    if (!before) {
      setHasMore(false);
      return;
    }

    setLoadingMore(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .lt('sent_at', before)
        .order('sent_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const older = (data ?? []).reverse();
      if (!older.length) {
        setHasMore(false);
        return;
      }

      setMessages((prev) => {
        // prepend mantendo unicidade
        const prevIds = new Set(prev.map((m) => m.id));
        const merged = [...older.filter((m) => !prevIds.has(m.id)), ...prev];
        merged.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        return merged;
      });

      oldestSentAtRef.current = older[0].sent_at;
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch (err) {
      console.error('[RealtimeMessages] Error loading more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  const refetchMessages = useCallback(async () => {
    if (!conversationId) return;
    await fetchMessages(conversationId);
  }, [conversationId, fetchMessages]);

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setLoadingMore(false);
    oldestSentAtRef.current = null;

    if (!conversationId) {
      setLoading(false);
      return;
    }

    console.log(`[RealtimeMessages] Conversation changed to: ${conversationId}`);
    fetchMessages(conversationId);

    if (channelRef.current) {
      console.log('[RealtimeMessages] Cleaning up previous channel');
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const activeId = activeIdRef.current;
          if (!activeId || activeId !== conversationId) return;

          if (payload.eventType === 'INSERT') {
            const newMessage = payload.new as Message;

            setMessages((prev) => {
              if (newMessage.conversation_id !== conversationId) return prev;
              if (prev.some((m) => m.id === newMessage.id)) return prev;

              // ✅ FIX: Detecção mais robusta de mensagem optimistic
              const newTime = new Date(newMessage.sent_at).getTime();
              const optimisticIdx = prev.findIndex((m) => {
                // 1. Verifica se ID parece temporário
                const isTemporaryId = String(m.id).startsWith('tmp_') ||
                  (String(m.id).length < 20 && !m.provider_message_id);

                if (!isTemporaryId) return false;

                // 2. Mesmo conteúdo
                if (m.content !== newMessage.content) return false;

                // 3. Mesma direção (outbound)
                if (m.direction !== newMessage.direction) return false;

                // 4. Dentro da janela de tempo (60s para ser mais tolerante)
                const prevTime = new Date(m.sent_at).getTime();
                return Math.abs(newTime - prevTime) < 60000;
              });

              let updated: Message[];
              if (optimisticIdx >= 0) {
                // Substituir optimistic pela mensagem real
                updated = [...prev];
                updated[optimisticIdx] = newMessage;
              } else {
                // Adicionar nova mensagem
                updated = [...prev, newMessage];
              }

              updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());

              // se recebemos algo mais antigo que o "oldest", atualiza referência
              if (!oldestSentAtRef.current || new Date(newMessage.sent_at) < new Date(oldestSentAtRef.current)) {
                oldestSentAtRef.current = newMessage.sent_at;
              }
              return updated;
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Message;
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          } else if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as any)?.id;
            if (!oldId) return;
            setMessages((prev) => prev.filter((m) => m.id !== oldId));
          }
        }
      )
      .subscribe((status: string) => {
        console.log(`[RealtimeMessages] Subscription status: ${status}`);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`[RealtimeMessages] Subscription error (${status}), retrying...`);
          setTimeout(() => conversationId && fetchMessages(conversationId), 1500);
        }
      });

    channelRef.current = channel;

    // ✅ POLLING FALLBACK: Atualiza a cada 10 segundos caso realtime falhe
    const pollInterval = setInterval(() => {
      if (conversationId) {
        console.log('[RealtimeMessages] Polling fallback tick');
        fetchMessages(conversationId);
      }
    }, 10000);

    return () => {
      clearInterval(pollInterval);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [conversationId, fetchMessages]);

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMoreMessages,
    refetchMessages,
    setMessages,
  };
}