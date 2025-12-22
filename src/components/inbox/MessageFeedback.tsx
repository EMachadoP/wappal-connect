import { useState } from 'react';
import { ThumbsUp, ThumbsDown, BookmarkPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface MessageFeedbackProps {
  messageId: string;
  conversationId: string;
  messageContent: string;
}

export function MessageFeedback({ messageId, conversationId, messageContent }: MessageFeedbackProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [currentRating, setCurrentRating] = useState<'up' | 'down' | null>(null);
  const [procedureDialogOpen, setProcedureDialogOpen] = useState(false);
  const [procedureForm, setProcedureForm] = useState({
    title: '',
    problem: '',
    solution: messageContent,
    category: 'general',
  });

  const handleFeedback = async (rating: 'up' | 'down') => {
    if (loading) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      // Check if feedback already exists
      const { data: existing } = await supabase
        .from('message_feedback')
        .select('id')
        .eq('message_id', messageId)
        .eq('created_by', user.id)
        .maybeSingle();

      if (existing) {
        // Update existing
        await supabase
          .from('message_feedback')
          .update({ rating })
          .eq('id', existing.id);
      } else {
        // Insert new
        await supabase
          .from('message_feedback')
          .insert({
            message_id: messageId,
            conversation_id: conversationId,
            rating,
            created_by: user.id,
          });
      }

      setCurrentRating(rating);
      toast({ title: rating === 'up' ? 'Feedback positivo registrado!' : 'Feedback negativo registrado' });
    } catch (error) {
      console.error('Feedback error:', error);
      toast({ variant: 'destructive', title: 'Erro ao salvar feedback' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProcedure = async () => {
    if (!procedureForm.title.trim() || !procedureForm.problem.trim()) {
      toast({ variant: 'destructive', title: 'Preencha título e problema' });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      // Create snippet for approval
      const { error } = await supabase
        .from('kb_snippets')
        .insert({
          title: procedureForm.title,
          category: procedureForm.category,
          problem_text: procedureForm.problem,
          solution_text: procedureForm.solution,
          source: 'agent_feedback',
          approved: false,
        });

      if (error) throw error;

      // Mark feedback as procedure
      await supabase
        .from('message_feedback')
        .insert({
          message_id: messageId,
          conversation_id: conversationId,
          rating: 'up',
          save_as_procedure: true,
          created_by: user.id,
        });

      toast({ title: 'Procedimento salvo para aprovação!' });
      setProcedureDialogOpen(false);
      setProcedureForm({ title: '', problem: '', solution: messageContent, category: 'general' });
    } catch (error) {
      console.error('Save procedure error:', error);
      toast({ variant: 'destructive', title: 'Erro ao salvar procedimento' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 mt-1">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-6 w-6',
            currentRating === 'up' && 'text-success bg-success/10'
          )}
          onClick={() => handleFeedback('up')}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-6 w-6',
            currentRating === 'down' && 'text-destructive bg-destructive/10'
          )}
          onClick={() => handleFeedback('down')}
          disabled={loading}
        >
          <ThumbsDown className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            setProcedureForm(prev => ({ ...prev, solution: messageContent }));
            setProcedureDialogOpen(true);
          }}
          disabled={loading}
          title="Salvar como procedimento"
        >
          <BookmarkPlus className="h-3 w-3" />
        </Button>
      </div>

      <Dialog open={procedureDialogOpen} onOpenChange={setProcedureDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar como Procedimento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input
                value={procedureForm.title}
                onChange={(e) => setProcedureForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Ex: Como resolver problema X"
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Input
                value={procedureForm.category}
                onChange={(e) => setProcedureForm(prev => ({ ...prev, category: e.target.value }))}
                placeholder="Ex: suporte, vendas, financeiro"
              />
            </div>
            <div className="space-y-2">
              <Label>Problema / Pergunta do Cliente</Label>
              <Textarea
                value={procedureForm.problem}
                onChange={(e) => setProcedureForm(prev => ({ ...prev, problem: e.target.value }))}
                placeholder="Descreva o problema ou pergunta..."
                className="min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Solução / Resposta</Label>
              <Textarea
                value={procedureForm.solution}
                onChange={(e) => setProcedureForm(prev => ({ ...prev, solution: e.target.value }))}
                placeholder="Descreva a solução..."
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcedureDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveProcedure} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar para Aprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
