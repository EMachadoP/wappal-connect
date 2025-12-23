import { useState, useEffect } from 'react';
import { Bot, User, Pause, Play, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AIControlBarProps {
  conversationId: string;
  aiMode: 'AUTO' | 'COPILOT' | 'OFF';
  aiPausedUntil: string | null;
  humanControl: boolean;
  onModeChange?: (mode: 'AUTO' | 'COPILOT' | 'OFF') => void;
}

export function AIControlBar({
  conversationId,
  aiMode: initialAiMode,
  aiPausedUntil: initialPausedUntil,
  humanControl: initialHumanControl,
  onModeChange,
}: AIControlBarProps) {
  const [aiMode, setAiMode] = useState(initialAiMode);
  const [aiPausedUntil, setAiPausedUntil] = useState(initialPausedUntil);
  const [humanControl, setHumanControl] = useState(initialHumanControl);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAiMode(initialAiMode);
    setAiPausedUntil(initialPausedUntil);
    setHumanControl(initialHumanControl);
  }, [initialAiMode, initialPausedUntil, initialHumanControl]);

  const isPaused = aiPausedUntil && new Date(aiPausedUntil) > new Date();
  const pauseMinutes = isPaused 
    ? Math.round((new Date(aiPausedUntil).getTime() - Date.now()) / 60000)
    : 0;

  const handleSetMode = async (mode: 'AUTO' | 'COPILOT' | 'OFF') => {
    setLoading(true);
    try {
      const updates: Record<string, unknown> = {
        ai_mode: mode,
        ai_paused_until: null,
      };

      if (mode === 'AUTO') {
        updates.human_control = false;
      }

      const { error } = await supabase
        .from('conversations')
        .update(updates)
        .eq('id', conversationId);

      if (error) throw error;

      // Log event
      await supabase.from('ai_events').insert({
        conversation_id: conversationId,
        event_type: 'ai_mode_changed',
        message: mode === 'AUTO' 
          ? '🤖 IA retomada em modo automático.'
          : mode === 'COPILOT'
          ? '🧑‍✈️ IA em modo copiloto (apenas sugestões).'
          : '⏸️ IA desativada manualmente.',
      });

      setAiMode(mode);
      setAiPausedUntil(null);
      if (mode === 'AUTO') {
        setHumanControl(false);
      }
      
      onModeChange?.(mode);
      
      toast.success(
        mode === 'AUTO' 
          ? 'IA retomada' 
          : mode === 'COPILOT' 
          ? 'Modo copiloto ativado'
          : 'IA desativada'
      );
    } catch (error) {
      console.error('Error updating AI mode:', error);
      toast.error('Erro ao atualizar modo IA');
    } finally {
      setLoading(false);
    }
  };

  const getModeColor = () => {
    switch (aiMode) {
      case 'AUTO': return 'bg-green-500/20 text-green-600 border-green-500/30';
      case 'COPILOT': return 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30';
      case 'OFF': return 'bg-red-500/20 text-red-600 border-red-500/30';
    }
  };

  const getModeIcon = () => {
    switch (aiMode) {
      case 'AUTO': return <Bot className="w-3 h-3" />;
      case 'COPILOT': return <User className="w-3 h-3" />;
      case 'OFF': return <Pause className="w-3 h-3" />;
    }
  };

  const getModeLabel = () => {
    switch (aiMode) {
      case 'AUTO': return 'IA Auto';
      case 'COPILOT': return 'Copiloto';
      case 'OFF': return 'IA Off';
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30">
      <div className="flex items-center gap-2 flex-1">
        <Badge variant="outline" className={`${getModeColor()} text-xs`}>
          {getModeIcon()}
          <span className="ml-1">{getModeLabel()}</span>
        </Badge>

        {humanControl && (
          <Badge variant="outline" className="bg-blue-500/20 text-blue-600 border-blue-500/30 text-xs">
            <User className="w-3 h-3 mr-1" />
            Humano ativo
          </Badge>
        )}

        {isPaused && (
          <Badge variant="outline" className="bg-orange-500/20 text-orange-600 border-orange-500/30 text-xs">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Pausado {pauseMinutes}min
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1">
        {aiMode !== 'AUTO' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-green-600 hover:bg-green-500/10"
            onClick={() => handleSetMode('AUTO')}
            disabled={loading}
          >
            <Play className="w-3 h-3 mr-1" />
            Retomar IA
          </Button>
        )}

        {aiMode !== 'COPILOT' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-yellow-600 hover:bg-yellow-500/10"
            onClick={() => handleSetMode('COPILOT')}
            disabled={loading}
          >
            <User className="w-3 h-3 mr-1" />
            Copiloto
          </Button>
        )}

        {aiMode !== 'OFF' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-red-600 hover:bg-red-500/10"
            onClick={() => handleSetMode('OFF')}
            disabled={loading}
          >
            <Pause className="w-3 h-3 mr-1" />
            Desativar
          </Button>
        )}
      </div>
    </div>
  );
}