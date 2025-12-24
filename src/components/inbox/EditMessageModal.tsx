import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface EditMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  currentContent: string;
  onSaved: (newContent: string) => void;
}

export function EditMessageModal({
  open,
  onOpenChange,
  messageId,
  currentContent,
  onSaved,
}: EditMessageModalProps) {
  const [content, setContent] = useState(currentContent);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContent(currentContent);
  }, [currentContent, open]);

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error('A mensagem não pode estar vazia');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('messages')
        .update({ content: content.trim() })
        .eq('id', messageId);

      if (error) throw error;

      toast.success('Mensagem atualizada');
      onSaved(content.trim());
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating message:', error);
      toast.error('Erro ao atualizar mensagem');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar mensagem</DialogTitle>
        </DialogHeader>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[100px]"
          placeholder="Digite a mensagem..."
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !content.trim()}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
