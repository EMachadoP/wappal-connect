import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type Message = Database['public']['Tables']['messages']['Row'];

export function useRealtimeMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const channelRef = useRef<any>(null);
  const pendingReq = useRef(0);
  const lastFetchTime = useRef(0);
  const PAGE_SIZE = 100;

  const fetchMessages = useCallback(async (id: string) => {
    // Throttle fetches
    const now = Date.now();
    if (now - lastFetchTime.current < 200) return;
    lastFetchTime.current = now;

    console.log(`[RealtimeMessages] Fetching initial messages for: ${id}`);
    setLoading(true);
    setHasMore(true);

    const reqId = ++pendingReq.current;

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('sent_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      // ✅ Stale response protection
      if (reqId !== pendingReq.current) return;

      if (data) {
        setMessages(data.reverse());
        setHasMore(data.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error('[RealtimeMessages] Error fetching:', err);
    } finally {
      if (reqId === pendingReq.current) {
        setLoading(false);
      }
    }
  }, []);

  const loadMoreMessages = useCallback(async () => {
    if (!conversationId || loadingMore || !hasMore || messages.length === 0) return;

    setLoadingMore(true);
    const oldestMessage = messages[0];

    console.log(`[RealtimeMessages] Loading more messages before: ${oldestMessage.sent_at}`);

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .lt('sent_at', oldestMessage.sent_at)
        .order('sent_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      if (data && data.length > 0) {
        const olderMessages = data.reverse();
        setMessages(prev => [...olderMessages, ...prev]);
        setHasMore(data.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('[RealtimeMessages] Error loading more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, loadingMore, hasMore, messages]);

  useEffect(() => {
    setMessages([]);
    if (!conversationId) {
      setLoading(false);
      return;
    }

    pendingReq.current++;
    fetchMessages(conversationId);

    // Cleanup previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Subscribe to ALL changes for this conversation's messages
    const channel = supabase.channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newMessage = payload.new as Message;
            setMessages((prev) => {
              if (newMessage.conversation_id !== conversationId) return prev;
              if (prev.some((m) => m.id === newMessage.id)) return prev;

              return [...prev, newMessage].sort(
                (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
              );
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Message;
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          } else if (payload.eventType === 'DELETE') {
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [conversationId, fetchMessages]);

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMoreMessages,
    setMessages
  };
}