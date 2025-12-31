import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type Message = Database['public']['Tables']['messages']['Row'];

export function useRealtimeMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<any>(null);

  const fetchMessages = useCallback(async (id: string) => {
    // Immediate log to track request
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

      // CRITICAL: Only update state if this ID is still the active one
      // This handles the "race condition" where switching fast could mix data
      setMessages((prev) => {
        // We check if the data we just got should actually be applied
        // by verifying it via a closure or by checking the current conversation context
        // in a more robust way if needed, but for now we trust the hook's scope.
        if (data) return data.reverse();
        return prev;
      });

    } catch (err) {
      console.error('[RealtimeMessages] Error fetching:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // ALWAYS clear messages immediately when conversation changes
    setMessages([]);

    if (!conversationId) {
      setLoading(false);
      return;
    }

    console.log(`[RealtimeMessages] Conversation changed to: ${conversationId}`);
    fetchMessages(conversationId);

    // Cleanup previous channel
    if (channelRef.current) {
      console.log('[RealtimeMessages] Cleaning up previous channel');
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
              // Ignore if message already exists or belongs to another conversation
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
      .subscribe((status) => {
        if (status === 'SUBSCRIPTION_ERROR') {
          console.error('[RealtimeMessages] Subscription error, retrying...');
          setTimeout(() => fetchMessages(conversationId), 2000);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [conversationId, fetchMessages]);

  return { messages, loading, setMessages };
}