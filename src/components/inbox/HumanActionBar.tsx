import { useState } from 'react';
import { FileText, CheckCircle2, Bot, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface HumanActionBarProps {
  conversationId: string;
  humanControl: boolean;
  aiMode: 'AUTO' | 'COPILOT' | 'OFF';
  hasOpenProtocol?: boolean;
  onResolveConversation?: () => void;
  onGenerateProtocol?: () => void;
  onAiModeChange?: (mode: 'AUTO' | 'COPILOT' | 'OFF') => void;
}

export function HumanActionBar({
  conversationId,
  humanControl,
  aiMode,
  hasOpenProtocol = false,
  onResolveConversation,
  onGenerateProtocol,
  onAiModeChange,
}: HumanActionBarProps) {
  const [loading, setLoading] = useState(false);

  // Only show when human has taken control
  if (!humanControl && aiMode === 'AUTO') {
    return null;
  }

  const handleReturnToAI = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('conversations')
        .update({
          ai_mode: 'AUTO',
          human_control: false,
          ai_paused_until: null,
        })
        .eq('id', conversationId);

      if (error) throw error;

      // Log event
      await supabase.from('ai_events').insert({
        conversation_id: conversationId,
        event_type: 'ai_resumed',
        message: '🤖 IA retomada pelo operador.',
      });

      onAiModeChange?.('AUTO');
      toast.success('IA retomada');
    } catch (error) {
      console.error('Error returning to AI:', error);
      toast.error('Erro ao retomar IA');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-accent/30">
      <span className="text-xs text-muted-foreground mr-auto">
        Atendimento humano ativo
      </span>

      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={onGenerateProtocol}
        disabled={loading}
      >
        <FileText className="w-3 h-3 mr-1" />
        {hasOpenProtocol ? 'Ver Protocolo' : 'Gerar Protocolo'}
      </Button>

      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={onResolveConversation}
        disabled={loading}
      >
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Resolver
      </Button>

      <Button
        size="sm"
        variant="default"
        className="h-7 text-xs bg-green-600 hover:bg-green-700"
        onClick={handleReturnToAI}
        disabled={loading}
      >
        <Bot className="w-3 h-3 mr-1" />
        Devolver para IA
      </Button>
    </div>
  );
}
