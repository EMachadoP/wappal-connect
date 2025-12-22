import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Entity {
  id: string;
  name: string;
  type: string;
}

interface Participant {
  id: string;
  name: string;
  role_type?: string | null;
  confidence: number;
  entity_id?: string | null;
  contact_id: string;
  entity?: Entity | null;
}

interface ContactInfo {
  whatsapp_display_name?: string | null;
  tags?: string[];
}

interface ParticipantState {
  current_participant_id?: string | null;
  identification_asked: boolean;
  last_confirmed_at?: string | null;
}

export function useParticipantInfo(contactId: string | undefined, conversationId: string | undefined) {
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [participantState, setParticipantState] = useState<ParticipantState | null>(null);
  const [displayNameType, setDisplayNameType] = useState<string>('UNKNOWN');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!contactId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Fetch contact info
      const { data: contact } = await supabase
        .from('contacts')
        .select('whatsapp_display_name, tags')
        .eq('id', contactId)
        .single();

      if (contact) {
        setContactInfo(contact);

        // Get display name type from DB function
        if (contact.whatsapp_display_name) {
          const { data: typeResult } = await supabase
            .rpc('detect_display_name_type', { display_name: contact.whatsapp_display_name });
          setDisplayNameType(typeResult || 'UNKNOWN');
        }
      }

      // Fetch primary participant for contact
      const { data: participants } = await supabase
        .from('participants')
        .select('*, entities:entity_id(*)')
        .eq('contact_id', contactId)
        .eq('is_primary', true)
        .limit(1);

      if (participants && participants.length > 0) {
        const p = participants[0];
        setParticipant({
          ...p,
          entity: p.entities as Entity | null,
        });
      } else {
        setParticipant(null);
      }

      // Fetch conversation participant state
      if (conversationId) {
        const { data: state } = await supabase
          .from('conversation_participant_state')
          .select('*')
          .eq('conversation_id', conversationId)
          .single();

        setParticipantState(state);
      }
    } catch (error) {
      console.error('Error fetching participant info:', error);
    } finally {
      setLoading(false);
    }
  }, [contactId, conversationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!contactId) return;

    const participantChannel = supabase
      .channel(`participant-${contactId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'participants',
          filter: `contact_id=eq.${contactId}`,
        },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(participantChannel);
    };
  }, [contactId, fetchData]);

  return {
    participant,
    contactInfo,
    participantState,
    displayNameType,
    loading,
    refetch: fetchData,
  };
}
