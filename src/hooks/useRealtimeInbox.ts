import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Conversation {
  id: string;
  contact: any;
  last_message: string;
  last_message_type: string;
  last_message_at: string | null;
  unread_count: number;
  assigned_to: string | null;
  status: string;
  priority: string | null;
}

interface UseRealtimeInboxProps {
  onNewInboundMessage?: () => void;
}

export function useRealtimeInbox({ onNewInboundMessage }: UseRealtimeInboxProps = {}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<any>(null);

  const fetchConversations = useCallback(async () => {
    // Optimized selection: only columns needed for the list UI
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        id, 
        status, 
        priority, 
        unread_count, 
        last_message_at, 
        assigned_to,
        contacts (id, name, phone, chat_lid, profile_picture_url)
      `)
      .order('last_message_at', { ascending: false });

    if (!error && data) {
      setConversations(data.map((conv: any) => ({
        id: conv.id,
        contact: conv.contacts,
        last_message: 'Ver histórico...', // Removed content fetch to keep list light
        last_message_type: 'text',
        last_message_at: conv.last_message_at,
        unread_count: conv.unread_count,
        assigned_to: conv.assigned_to,
        status: conv.status,
        priority: conv.priority,
      })));
    }
    setLoading(false);
  }, []);

  const setupSubscription = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel('inbox-realtime-global')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => fetchConversations()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'sender_type=eq.contact' },
        () => {
          onNewInboundMessage?.();
          fetchConversations();
        }
      )
      .subscribe();

    channelRef.current = channel;
  }, [fetchConversations, onNewInboundMessage]);

  useEffect(() => {
    fetchConversations();
    setupSubscription();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchConversations();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchConversations, setupSubscription]);

  return { conversations, loading, refetch: fetchConversations };
}