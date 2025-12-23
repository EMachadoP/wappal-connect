import { useState, useEffect } from 'react';
import { FileText, Send, Building2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Condominium {
  id: string;
  name: string;
}

interface GenerateProtocolModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactId?: string;
  condominiums: Condominium[];
  activeCondominiumId?: string | null;
  onProtocolCreated?: (protocolCode: string) => void;
}

export function GenerateProtocolModal({
  open,
  onOpenChange,
  conversationId,
  contactId,
  condominiums,
  activeCondominiumId,
  onProtocolCreated,
}: GenerateProtocolModalProps) {
  const [loading, setLoading] = useState(false);
  const [condominiumId, setCondominiumId] = useState<string>(activeCondominiumId || '');
  const [category, setCategory] = useState<string>('operational');
  const [priority, setPriority] = useState<string>('normal');
  const [summary, setSummary] = useState<string>('');
  const [notifyGroup, setNotifyGroup] = useState(true);

  useEffect(() => {
    if (activeCondominiumId) {
      setCondominiumId(activeCondominiumId);
    } else if (condominiums.length === 1) {
      setCondominiumId(condominiums[0].id);
    }
  }, [activeCondominiumId, condominiums]);

  const handleGenerateProtocol = async () => {
    if (!condominiumId) {
      toast.error('Selecione um condomínio');
      return;
    }

    setLoading(true);
    try {
      // Generate protocol code
      const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
      const { data: existingProtocols } = await supabase
        .from('protocols')
        .select('protocol_code')
        .like('protocol_code', `${yearMonth}-%`)
        .order('protocol_code', { ascending: false })
        .limit(1);

      let sequence = 1;
      if (existingProtocols && existingProtocols.length > 0) {
        const lastCode = existingProtocols[0].protocol_code;
        const lastSequence = parseInt(lastCode.split('-')[1] || '0');
        sequence = lastSequence + 1;
      }
      const protocolCode = `${yearMonth}-${sequence.toString().padStart(4, '0')}`;

      // Create protocol
      const { data: protocol, error } = await supabase
        .from('protocols')
        .insert({
          protocol_code: protocolCode,
          conversation_id: conversationId,
          contact_id: contactId,
          condominium_id: condominiumId,
          category,
          priority,
          summary: summary || null,
          status: 'open',
          created_by_type: 'human',
        })
        .select()
        .single();

      if (error) throw error;

      // Update conversation with protocol
      await supabase
        .from('conversations')
        .update({ protocol: protocolCode })
        .eq('id', conversationId);

      // Log event
      await supabase.from('ai_events').insert({
        conversation_id: conversationId,
        event_type: 'protocol_created',
        message: `📋 Protocolo ${protocolCode} criado manualmente.`,
        metadata: { protocol_id: protocol.id, notify_group: notifyGroup },
      });

      // Call protocol-opened function if notify is enabled
      if (notifyGroup) {
        await supabase.functions.invoke('protocol-opened', {
          body: {
            conversation_id: conversationId,
            protocol_code: protocolCode,
          },
        });
      }

      toast.success(`Protocolo ${protocolCode} criado!`);
      onProtocolCreated?.(protocolCode);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating protocol:', error);
      toast.error('Erro ao criar protocolo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Gerar Protocolo
          </DialogTitle>
          <DialogDescription>
            Crie um protocolo de atendimento para esta conversa
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Condomínio */}
          <div className="grid gap-2">
            <Label htmlFor="condominium">Condomínio *</Label>
            <Select value={condominiumId} onValueChange={setCondominiumId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o condomínio" />
              </SelectTrigger>
              <SelectContent>
                {condominiums.map((condo) => (
                  <SelectItem key={condo.id} value={condo.id}>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4" />
                      {condo.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Categoria */}
          <div className="grid gap-2">
            <Label htmlFor="category">Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operational">Suporte / Operacional</SelectItem>
                <SelectItem value="maintenance">Manutenção Corretiva</SelectItem>
                <SelectItem value="budget">Orçamento</SelectItem>
                <SelectItem value="financial">Financeiro</SelectItem>
                <SelectItem value="administrative">Administrativo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Prioridade */}
          <div className="grid gap-2">
            <Label htmlFor="priority">Prioridade</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Baixa</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Resumo */}
          <div className="grid gap-2">
            <Label htmlFor="summary">Resumo (opcional)</Label>
            <Textarea
              id="summary"
              placeholder="Descreva brevemente o atendimento..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
            />
          </div>

          {/* Notificar grupo */}
          <div className="flex items-center justify-between">
            <Label htmlFor="notify-group" className="text-sm">
              Notificar grupo de técnicos
            </Label>
            <Switch
              id="notify-group"
              checked={notifyGroup}
              onCheckedChange={setNotifyGroup}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleGenerateProtocol} disabled={loading || !condominiumId}>
            {loading ? (
              'Criando...'
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Criar Protocolo
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
