import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Condominium {
  id: string;
  name: string;
  is_default: boolean;
}

interface UseContactCondominiumsReturn {
  condominiums: Condominium[];
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useContactCondominiums(contactId: string | null): UseContactCondominiumsReturn {
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCondominiums = useCallback(async () => {
    if (!contactId) {
      setCondominiums([]);
      return;
    }

    setLoading(true);
    // Clear old data immediately to prevent mixing
    setCondominiums([]);
    try {
      const { data, error } = await supabase
        .from('contact_condominiums')
        .select(`
          is_default,
          condominium:condominiums (
            id,
            name
          )
        `)
        .eq('contact_id', contactId);

      if (error) {
        console.error('Error fetching contact condominiums:', error);
        setCondominiums([]);
      } else if (data) {
        const formatted = data
          .filter((item: any) => item.condominium)
          .map((item: any) => ({
            id: item.condominium.id,
            name: item.condominium.name,
            is_default: item.is_default,
          }));
        setCondominiums(formatted);
      }
    } catch (err) {
      console.error('Error fetching contact condominiums:', err);
      setCondominiums([]);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchCondominiums();
  }, [fetchCondominiums]);

  return {
    condominiums,
    loading,
    refetch: fetchCondominiums,
  };
}
