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
  tab?: string;
  userId?: string;
}

export function useRealtimeInbox({ onNewInboundMessage, tab, userId }: UseRealtimeInboxProps = {}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const processedMessageIds = useRef<Set<string>>(new Set());
  const lastFetchTime = useRef<number>(0);
  const pendingReq = useRef(0);

  const fetchConversations = useCallback(async () => {
    // Throttle fetches to max once every 300ms
    const now = Date.now();
    if (now - lastFetchTime.current < 300) return;
    lastFetchTime.current = now;

    console.log('[RealtimeInbox] Fetching conversations for tab:', tab || 'all');

    let query = supabase
      .from('conversations')
      .select(`
        *,
        contacts (
          *,
          participants (
            id,
            name,
            is_primary
          )
        )
      `);

    // ✅ SQL-level filtering for performance + correctness
    if (tab === 'mine' && userId) {
      query = query.eq('status', 'open').eq('assigned_to', userId);
    } else if (tab === 'inbox') {
      query = query.eq('status', 'open').is('assigned_to', null);
    } else if (tab === 'resolved') {
      query = query.eq('status', 'resolved');
    } else {
      // 'all' or default: show everything open (assigned or not)
      query = query.eq('status', 'open');
    }

    // Always sort by most recent activity
    query = query.order('last_message_at', { ascending: false });

    // ✅ Pattern seguro: garante que só o último fetch atualiza o state
    const reqId = ++pendingReq.current;

    const { data, error } = await query;

    // ✅ Se outro fetch foi disparado depois, ignora este resultado (race condition protection)
    if (reqId !== pendingReq.current) return;

    if (!error && data) {
      const mapped = data.map((conv: any) => {
        // Get primary participant name if available
        const participants = conv.contacts?.participants || [];
        const primaryParticipant = participants.find((p: any) => p.is_primary) || participants[0];
        const participantName = primaryParticipant?.name;

        return {
          id: conv.id,
          contact: {
            ...conv.contacts,
            // Prioritize participant name over contact name/phone
            name: participantName || conv.contacts?.name || conv.contacts?.phone || 'Sem Nome',
          },
          // Falback safe para o preview
          last_message: conv.last_message || conv.last_message_content || 'Nenhuma mensagem',
          last_message_type: 'text',
          last_message_at: conv.last_message_at,
          reopened_at: conv.reopened_at,
          unread_count: conv.unread_count,
          assigned_to: conv.assigned_to,
          status: conv.status,
          priority: conv.priority,
        };
      });

      // Sort by greatest of last_message_at or reopened_at
      mapped.sort((a, b) => {
        const timeA = Math.max(
          a.last_message_at ? new Date(a.last_message_at).getTime() : 0,
          a.reopened_at ? new Date(a.reopened_at).getTime() : 0
        );
        const timeB = Math.max(
          b.last_message_at ? new Date(b.last_message_at).getTime() : 0,
          b.reopened_at ? new Date(b.reopened_at).getTime() : 0
        );
        return timeB - timeA;
      });

      setConversations(mapped);
    }
    setLoading(false);
  }, [tab, userId]);

  // Invalidate old requests when tab changes
  useEffect(() => {
    pendingReq.current++;
    setLoading(true); // Optional: show loading when tab switches deeply
    fetchConversations();
  }, [tab, userId]);

  useEffect(() => {
    // Initial fetch handled by the dependency effect above or manually if distinct
    // kept for safe measure if deps are stable
    fetchConversations();

    // Canal estável para Inbox global
    const channel = supabase.channel('global-inbox-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          console.log('[RealtimeInbox] Conversation record update');
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants' },
        (payload) => {
          console.log('[RealtimeInbox] Participant updated - refreshing list');
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMessage = payload.new;
          if (!newMessage || processedMessageIds.current.has(newMessage.id)) return;

          processedMessageIds.current.add(newMessage.id);
          console.log('[RealtimeInbox] New message incoming:', newMessage.id);

          if (newMessage.sender_type === 'contact') {
            onNewInboundMessage?.();
          }

          fetchConversations();

          // Limpa o set ocasionalmente para não crescer infinitamente
          if (processedMessageIds.current.size > 100) {
            processedMessageIds.current = new Set([...processedMessageIds.current].slice(-50));
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[RealtimeInbox] Cleaning up channel');
      supabase.removeChannel(channel);
    };
  }, [fetchConversations, onNewInboundMessage]);

  return { conversations, loading, refetch: fetchConversations };
}
