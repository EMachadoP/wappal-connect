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
      .order('sent_at', { ascending: false }) // Busca invertida para paginação eficiente
      .range(from, to);

    if (!error && data) {
      const reversed = [...data].reverse();
      setMessages(prev => pageNum === 0 ? reversed : [...reversed, ...prev]);
      setHasMore(data.length === PAGE_SIZE);
    }
    
    if (pageNum === 0) setLoading(false);
  }, []);

  const loadMore = useCallback(() => {
    if (!loading && hasMore && conversationId) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchMessages(conversationId, nextPage);
    }
  }, [loading, hasMore, conversationId, page, fetchMessages]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setPage(0);
      setHasMore(true);
      return;
    }

    fetchMessages(conversationId, 0);

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages(prev => {
            if (prev.some(m => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, fetchMessages]);

  return { messages, loading, hasMore, loadMore, setMessages };
}