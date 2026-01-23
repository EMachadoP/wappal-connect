import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getChatDisplayName } from '@/utils/displayUtils';

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
  chat_id?: string | null;
}

type InboxTab = 'inbox' | 'mine' | 'resolved';

interface UseRealtimeInboxProps {
  onNewInboundMessage?: () => void;
  tab?: InboxTab;
  userId?: string | null;
}

export function useRealtimeInbox({ onNewInboundMessage, tab = 'inbox', userId }: UseRealtimeInboxProps = {}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const processedMessageIds = useRef<Set<string>>(new Set());
  const lastFetchTime = useRef<number>(0);

  // ✅ Anti out-of-order: só o fetch mais recente pode setar state
  const fetchSeq = useRef(0);

  const fetchConversations = useCallback(async () => {
    // Throttle fetches to max once every 300ms
    const now = Date.now();
    if (now - lastFetchTime.current < 300) return;
    lastFetchTime.current = now;

    const seq = ++fetchSeq.current;

    console.log('[RealtimeInbox] Fetching conversations...', { tab });

    let query = supabase
      .from('conversations')
      .select(`*, contacts (*, participants(*))`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    // ✅ Filtra na query (sem view, sem join com messages)
    if (tab === 'mine') {
      if (userId) query = query.eq('status', 'open').eq('assigned_to', userId);
      else query = query.eq('status', 'open').eq('assigned_to', '__MISSING_USER__'); // evita vazar tudo
    } else if (tab === 'inbox') {
      // ✅ ENTRADA = apenas conversas NÃO atribuídas
      query = query.eq('status', 'open').is('assigned_to', null);
    } else if (tab === 'resolved') {
      query = query.eq('status', 'resolved');
    }

    const { data, error } = await query;

    // ✅ Se um fetch mais novo já rodou, ignora este resultado
    if (seq !== fetchSeq.current) return;

    if (!error && data) {
      setConversations(
        data.map((conv: any) => ({
          id: conv.id,
          contact: {
            ...conv.contacts,
            name: getChatDisplayName(conv.contacts, null, conv.title, conv.chat_id),
            phone: conv.contacts?.phone || (conv.chat_id ? conv.chat_id.split('@')[0] : "")
          },
          last_message:
            conv.last_message ??
            conv.last_message_content ??
            conv.last_message_text ??
            'Nenhuma mensagem',
          last_message_type: conv.last_message_type ?? 'text',
          last_message_at: conv.last_message_at,
          unread_count: conv.unread_count ?? 0,
          assigned_to: conv.assigned_to,
          status: conv.status,
          priority: conv.priority,
          chat_id: conv.chat_id ?? null,
        }))
      );
    } else {
      console.error('[RealtimeInbox] fetch error:', error);
    }

    setLoading(false);
  }, [tab, userId]);

  useEffect(() => {
    fetchConversations();

    // ✅ POLLING FALLBACK: Atualiza a cada 15 segundos caso realtime falhe
    const pollInterval = setInterval(() => {
      console.log('[RealtimeInbox] Polling fallback tick');
      fetchConversations();
    }, 15000);

    const channel = supabase
      .channel(`global-inbox-updates:${tab}:${userId ?? 'anon'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        console.log('[RealtimeInbox] Conversation record update');
        fetchConversations();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMessage: any = payload.new;
        if (!newMessage || processedMessageIds.current.has(newMessage.id)) return;

        processedMessageIds.current.add(newMessage.id);
        console.log('[RealtimeInbox] New message incoming:', newMessage.id);

        if (newMessage.sender_type === 'contact') {
          onNewInboundMessage?.();
        }

        fetchConversations();

        if (processedMessageIds.current.size > 200) {
          processedMessageIds.current = new Set([...processedMessageIds.current].slice(-100));
        }
      })
      .subscribe((status) => {
        console.log(`[RealtimeInbox] Subscription status: ${status}`);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[RealtimeInbox] Connection issue, will rely on polling');
        }
      });

    return () => {
      console.log('[RealtimeInbox] Cleaning up channel and poll');
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [fetchConversations, onNewInboundMessage, tab, userId]);

  return { conversations, loading, refetch: fetchConversations };
}
