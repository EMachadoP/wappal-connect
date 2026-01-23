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
      // Map conversations to prioritize participant name over contact name or group title
      const conversationsWithNames = data.map(conv => {
        const isGroup = conv.is_group;
        const groupTitle = conv.title || 'Grupo';

        // Se for grupo, não deve ter contact preenchido com dados de pessoa
        if (isGroup) {
          return {
            ...conv,
            title: groupTitle,
            contact: {
              name: groupTitle,
              profile_picture_url: null
            }
          };
        }

        // DMs: contact pode vir null se RLS bloquear ou não existir
        const contactData = conv.contacts || {
          id: conv.contact_id,
          name: conv.title || "Sem Nome", // Usa title como fallback robusto (denormalizado)
          phone: ""
        };

        return {
          ...conv,
          contact: {
            ...contactData,
            // Prioridade: Participant > Contact > Title (Denormalized) > Phone > Sem Nome
            name: conv.participants?.[0]?.name || contactData.name || conv.title || contactData.phone || 'Sem Nome'
          }
        };
      });
      setConversations(conversationsWithNames);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConversations();

    // Subscribe to both conversations and participants changes
    // so the list updates when a participant is identified
    const sub = supabase
      .channel('conversations-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        fetchConversations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        fetchConversations();
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [fetchConversations]);

  return { conversations, loading, refetch: fetchConversations };
}