import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Utilitário para chamadas seguras às Edge Functions com tratamento de erro padronizado.
 */
export async function invokeFunction<T = any>(
  functionName: string, 
  body: Record<string, any> = {}
): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body,
    });

    if (error) {
      console.error(`[Edge Function Error: ${functionName}]`, error);
      toast.error(`Falha no serviço: ${functionName}`);
      return { data: null, error: error.message || 'Erro desconhecido' };
    }

    return { data: data as T, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha na conexão com o servidor';
    toast.error(message);
    return { data: null, error: message };
  }
}