import { useState, useEffect } from 'react';
import { FileText, Send, Building2, Plus, CheckCircle2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
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

interface Entity {
  id: string;
  name: string;
  type: string;
}

interface Participant {
  id: string;
  name: string;
  role_type?: string | null;
  entity?: Entity | null;
}

interface GenerateProtocolModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactId?: string;
  condominiums: Condominium[];
  activeCondominiumId?: string | null;
  participant?: Participant | null;
  onProtocolCreated?: (protocolCode: string) => void;
}

export function GenerateProtocolModal({
  open,
  onOpenChange,
  conversationId,
  contactId,
  condominiums: contactCondominiums,
  activeCondominiumId,
  participant,
  onProtocolCreated,
}: GenerateProtocolModalProps) {
  const [loading, setLoading] = useState(false);
  const [allCondominiums, setAllCondominiums] = useState<Condominium[]>([]);
  const [loadingCondominiums, setLoadingCondominiums] = useState(false);
  const [condominiumId, setCondominiumId] = useState<string>(activeCondominiumId || '');
  const [category, setCategory] = useState<string>('operational');
  const [priority, setPriority] = useState<string>('normal');
  const [summary, setSummary] = useState<string>('');
  const [notifyGroup, setNotifyGroup] = useState(true);
  const [showNewCondoForm, setShowNewCondoForm] = useState(false);
  const [newCondoName, setNewCondoName] = useState('');
  const [creatingCondo, setCreatingCondo] = useState(false);
  const [entityMatchedCondo, setEntityMatchedCondo] = useState<Condominium | null>(null);

  // Fetch all condominiums when modal opens
  useEffect(() => {
    if (open) {
      fetchAllCondominiums();
    }
  }, [open]);

  const fetchAllCondominiums = async () => {
    setLoadingCondominiums(true);
    try {
      const { data, error } = await supabase
        .from('condominiums')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setAllCondominiums(data || []);

      // Try to match entity name with condominium
      if (participant?.entity?.name && data) {
        const entityName = participant.entity.name.toLowerCase();
        const matchedCondo = data.find(c => 
          c.name.toLowerCase() === entityName ||
          c.name.toLowerCase().includes(entityName) ||
          entityName.includes(c.name.toLowerCase())
        );
        
        if (matchedCondo) {
          setEntityMatchedCondo(matchedCondo);
          if (!activeCondominiumId) {
            setCondominiumId(matchedCondo.id);
          }
        } else {
          setEntityMatchedCondo(null);
          // Pre-fill new condo name with entity name if no match
          setNewCondoName(participant.entity.name);
        }
      }
    } catch (err) {
      console.error('Error fetching condominiums:', err);
      setAllCondominiums([]);
    } finally {
      setLoadingCondominiums(false);
    }
  };

  // Use contact condominiums first, fallback to all condominiums
  const availableCondominiums = contactCondominiums.length > 0 
    ? contactCondominiums 
    : allCondominiums;

  useEffect(() => {
    if (activeCondominiumId) {
      setCondominiumId(activeCondominiumId);
    } else if (entityMatchedCondo) {
      setCondominiumId(entityMatchedCondo.id);
    } else if (availableCondominiums.length === 1) {
      setCondominiumId(availableCondominiums[0].id);
    }
  }, [activeCondominiumId, availableCondominiums, entityMatchedCondo]);

  const handleCreateCondominium = async () => {
    if (!newCondoName.trim()) {
      toast.error('Digite o nome do condomínio');
      return;
    }

    setCreatingCondo(true);
    try {
      const { data, error } = await supabase
        .from('condominiums')
        .insert({ name: newCondoName.trim() })
        .select()
        .single();

      if (error) throw error;

      // Link to contact if we have one
      if (contactId && data) {
        await supabase.from('contact_condominiums').insert({
          contact_id: contactId,
          condominium_id: data.id,
          is_default: true,
        });
      }

      toast.success('Condomínio criado!');
      setCondominiumId(data.id);
      setNewCondoName('');
      setShowNewCondoForm(false);
      await fetchAllCondominiums();
    } catch (err) {
      console.error('Error creating condominium:', err);
      toast.error('Erro ao criar condomínio');
    } finally {
      setCreatingCondo(false);
    }
  };

  const handleUseEntityAsCondominium = async () => {
    if (!participant?.entity?.name) return;
    setNewCondoName(participant.entity.name);
    setShowNewCondoForm(true);
  };

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
          requester_name: participant?.name || null,
          requester_role: participant?.role_type || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Get current user for assignment
      const { data: { user } } = await supabase.auth.getUser();

      // Update conversation with protocol, condominium, and assign to current user
      await supabase
        .from('conversations')
        .update({ 
          protocol: protocolCode,
          active_condominium_id: condominiumId,
          active_condominium_set_by: 'human',
          active_condominium_set_at: new Date().toISOString(),
          assigned_to: user?.id || null,
          assigned_at: new Date().toISOString(),
        })
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
        // Get condominium name
        const selectedCondo = availableCondominiums.find(c => c.id === condominiumId);
        
        await supabase.functions.invoke('protocol-opened', {
          body: {
            protocol_id: protocol.id,
            protocol_code: protocolCode,
            priority,
            category,
            summary: summary || 'Sem descrição',
            condominium_name: selectedCondo?.name || 'Não identificado',
            requester_name: participant?.name || 'Não identificado',
            requester_role: participant?.role_type || null,
            conversation_id: conversationId,
            contact_id: contactId,
            condominium_id: condominiumId,
            created_by_type: 'human',
            participant_id: participant?.id || null,
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

  // Show entity info if available and no condominium selected
  const showEntitySuggestion = participant?.entity && !condominiumId && !entityMatchedCondo && !showNewCondoForm;

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
          {/* Participant Info - show if identified */}
          {participant && (
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg text-sm">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-muted-foreground">Remetente:</span>
              <span className="font-medium">{participant.name}</span>
              {participant.role_type && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                  {participant.role_type}
                </span>
              )}
              {participant.entity && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{participant.entity.name}</span>
                </>
              )}
            </div>
          )}

          {/* Condomínio */}
          <div className="grid gap-2">
            <Label htmlFor="condominium">Condomínio *</Label>
            
            {/* Entity suggestion when no condominium matched */}
            {showEntitySuggestion && (
              <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-sm">
                <Building2 className="w-4 h-4 text-amber-600" />
                <span className="flex-1">
                  Usar <strong>{participant.entity!.name}</strong> como condomínio?
                </span>
                <Button size="sm" variant="outline" onClick={handleUseEntityAsCondominium}>
                  Cadastrar
                </Button>
              </div>
            )}

            {showNewCondoForm ? (
              <div className="flex gap-2">
                <Input
                  placeholder="Nome do condomínio"
                  value={newCondoName}
                  onChange={(e) => setNewCondoName(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleCreateCondominium} disabled={creatingCondo} size="sm">
                  {creatingCondo ? 'Salvando...' : 'Salvar'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowNewCondoForm(false)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={condominiumId} onValueChange={setCondominiumId} disabled={loadingCondominiums}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={loadingCondominiums ? 'Carregando...' : 'Selecione o condomínio'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCondominiums.map((condo) => (
                      <SelectItem key={condo.id} value={condo.id}>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          {condo.name}
                        </div>
                      </SelectItem>
                    ))}
                    {availableCondominiums.length === 0 && !loadingCondominiums && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        Nenhum condomínio cadastrado
                      </div>
                    )}
                  </SelectContent>
                </Select>
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={() => setShowNewCondoForm(true)}
                  title="Cadastrar novo condomínio"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            )}
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
