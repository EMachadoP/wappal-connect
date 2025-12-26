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

  useEffect(() => {
    fetchConversations();

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Global channel for list updates
    const channel = supabase.channel('global-inbox-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          console.log('[RealtimeInbox] Conversation changed');
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          console.log('[RealtimeInbox] New message in system');
          if (payload.new.sender_type === 'contact') {
            onNewInboundMessage?.();
          }
          fetchConversations();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [fetchConversations, onNewInboundMessage]);

  return { conversations, loading, refetch: fetchConversations };
}