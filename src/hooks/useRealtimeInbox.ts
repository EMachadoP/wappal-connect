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
    const { data, error } = await supabase
      .from('conversations')
      .select(`*, contacts (*)`)
      .order('last_message_at', { ascending: false });

    if (!error && data) {
      setConversations(data.map((conv: any) => ({
        id: conv.id,
        contact: conv.contacts,
        last_message: conv.last_message_content || 'Nenhuma mensagem',
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
    // Cleanup existing channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel('inbox-realtime-global')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          console.log('[Realtime] Conversation update detected');
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'sender_type=eq.contact' },
        (payload) => {
          console.log('[Realtime] New inbound message');
          onNewInboundMessage?.();
          fetchConversations(); // Update list to reflect last message
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Subscription status: ${status}`);
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          // Automatic reconnection logic is handled by Supabase client, 
          // but we can force a refresh if it drops
          setTimeout(setupSubscription, 3000);
        }
      });

    channelRef.current = channel;
  }, [fetchConversations, onNewInboundMessage]);

  useEffect(() => {
    fetchConversations();
    setupSubscription();

    // Re-fetch on tab focus to handle missed updates
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