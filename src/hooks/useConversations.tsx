import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useConversations() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        contacts (*),
        participants (
          id,
          name,
          role_type
        )
      `)
      .order('last_message_at', { ascending: false });

    if (!error && data) {
      // Map conversations to prioritize participant name over contact name
      const conversationsWithNames = data.map(conv => ({
        ...conv,
        contact: {
          ...conv.contacts,
          // Use participant name if available, otherwise use contact name
          name: conv.participants?.[0]?.name || conv.contacts?.name || conv.contacts?.phone || 'Sem Nome'
        }
      }));
      setConversations(conversationsWithNames);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConversations();

    const sub = supabase
      .channel('conversations-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        fetchConversations();
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [fetchConversations]);

  return { conversations, loading, refetch: fetchConversations };
}