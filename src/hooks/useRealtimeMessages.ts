import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type Message = Database['public']['Tables']['messages']['Row'];

export function useRealtimeMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<any>(null);

  const fetchSeq = useRef(0);
  const activeIdRef = useRef<string | null>(null);

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
        .limit(50);

      if (error) throw error;

      // ✅ ignora resultado velho (out-of-order)
      if (seq !== fetchSeq.current) return;
      if (activeIdRef.current !== id) return;

      setMessages((data ?? []).reverse());
    } catch (err) {
      console.error('[RealtimeMessages] Error fetching:', err);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMessages([]);

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

              return [...prev, newMessage].sort(
                (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
              );
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
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`[RealtimeMessages] Subscription error (${status}), retrying...`);
          setTimeout(() => conversationId && fetchMessages(conversationId), 1500);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [conversationId, fetchMessages]);

  return { messages, loading, setMessages };
}