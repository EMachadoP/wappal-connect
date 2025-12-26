import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type Message = Database['public']['Tables']['messages']['Row'];

const PAGE_SIZE = 50;

export function useRealtimeMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  
  const fetchMessages = useCallback(async (id: string, pageNum: number = 0) => {
    if (pageNum === 0) setLoading(true);
    
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('sent_at', { ascending: false })
      .range(from, to);

    if (!error && data) {
      const reversed = [...data].reverse();
      setMessages(prev => pageNum === 0 ? reversed : [...reversed, ...prev]);
      setHasMore(data.length === PAGE_SIZE);
    }
    
    if (pageNum === 0) setLoading(false);
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setPage(0);
      setHasMore(true);
      return;
    }

    fetchMessages(conversationId, 0);

    const channel = supabase
      .channel(`messages-room-${conversationId}`)
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages', 
          filter: `conversation_id=eq.${conversationId}` 
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages(prev => {
            const exists = prev.some(m => m.id === newMessage.id || (m.provider_message_id && m.provider_message_id === newMessage.provider_message_id));
            if (exists) return prev;
            return [...prev, newMessage];
          });
        }
      )
      .on(
        'postgres_changes',
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'messages', 
          filter: `conversation_id=eq.${conversationId}` 
        },
        (payload) => {
          const updatedMessage = payload.new as Message;
          setMessages(prev => prev.map(m => m.id === updatedMessage.id ? updatedMessage : m));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Realtime messages subscribed for:', conversationId);
        }
      });

    return () => { 
      supabase.removeChannel(channel); 
    };
  }, [conversationId, fetchMessages]);

  return { messages, loading, hasMore, loadMore: () => {}, setMessages };
}