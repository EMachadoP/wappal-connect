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

interface Template {
  id: string;
  title: string;
  category: string;
  match_keywords: string[];
  match_priority?: number;
}

interface GenerateProtocolModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactId?: string;
  condominiums: Condominium[];
  activeCondominiumId?: string | null;
  participant?: Participant | null;
  currentUserId?: string;
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
  currentUserId,
  onProtocolCreated,
}: GenerateProtocolModalProps) {
  const [loading, setLoading] = useState(false);
  const [allCondominiums, setAllCondominiums] = useState<Condominium[]>([]);
  const [loadingCondominiums, setLoadingCondominiums] = useState(false);
  const [condominiumId, setCondominiumId] = useState<string>(activeCondominiumId || '');
  const [summary, setSummary] = useState<string>('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('auto');
  const [suggestedTemplateId, setSuggestedTemplateId] = useState<string | null>(null);
  const [notifyGroup, setNotifyGroup] = useState(true);
  const [showNewCondoForm, setShowNewCondoForm] = useState(false);
  const [newCondoName, setNewCondoName] = useState('');
  const [creatingCondo, setCreatingCondo] = useState(false);
  const [entityMatchedCondo, setEntityMatchedCondo] = useState<Condominium | null>(null);

  useEffect(() => {
    if (open) {
      fetchAllCondominiums();
      fetchTemplates();
    }
  }, [open]);

  const fetchTemplates = async () => {
    try {
      const { data } = await supabase
        .from('task_templates' as any)
        .select('id, title, category, match_keywords, match_priority')
        .eq('active', true)
        .order('title');
      setTemplates((data as any) || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  // Keyword matching for suggestion
  useEffect(() => {
    if (!summary || templates.length === 0) {
      setSuggestedTemplateId(null);
      return;
    }

    const lowerSummary = summary.toLowerCase();
    let best = null;
    let maxMatches = 0;
    let maxPriority = -1;

    for (const t of templates) {
      let matches = 0;
      for (const kw of (t.match_keywords || [])) {
        if (lowerSummary.includes(kw.toLowerCase())) matches++;
      }

      const priority = t.match_priority || 0;

      // Higher matches wins, or same matches but higher priority wins
      if (matches > maxMatches || (matches > 0 && matches === maxMatches && priority > maxPriority)) {
        maxMatches = matches;
        maxPriority = priority;
        best = t.id;
      }
    }
    setSuggestedTemplateId(best);
  }, [summary, templates]);

  const fetchAllCondominiums = async () => {
    setLoadingCondominiums(true);
    try {
      // Use 'entities' table which is where Identificar Remetente saves
      const { data, error } = await supabase
        .from('entities')
        .select('id, name')
        .eq('type', 'condominio')
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
  let availableCondominiums = contactCondominiums.length > 0
    ? contactCondominiums
    : allCondominiums;

  // Ensure participant's entity is in the list if it exists
  if (participant?.entity && !availableCondominiums.find(c => c.id === participant.entity?.id)) {
    availableCondominiums = [
      { id: participant.entity.id, name: participant.entity.name },
      ...availableCondominiums
    ];
  }

  useEffect(() => {
    // Priority: Participant's registered entity > activeCondominiumId > Fuzzy Match > available[0]
    if (participant?.entity?.id) {
      setCondominiumId(participant.entity.id);
    } else if (activeCondominiumId) {
      setCondominiumId(activeCondominiumId);
    } else if (entityMatchedCondo) {
      setCondominiumId(entityMatchedCondo.id);
    } else if (availableCondominiums.length === 1) {
      setCondominiumId(availableCondominiums[0].id);
    }
  }, [activeCondominiumId, availableCondominiums, entityMatchedCondo, participant]);

  const handleCreateCondominium = async () => {
    if (!newCondoName.trim()) {
      toast.error('Digite o nome do condomínio');
      return;
    }

    setCreatingCondo(true);
    try {
      // Create in entities table first (where Identificar Remetente looks)
      const { data: entityData, error: entityError } = await supabase
        .from('entities')
        .insert({
          name: newCondoName.trim(),
          type: 'condominio'
        })
        .select()
        .single();

      if (entityError) throw entityError;

      // CRITICAL: Also create in condominiums table to satisfy foreign key constraint
      // This is needed because protocols table has FK to condominiums table
      const { error: condoError } = await supabase
        .from('condominiums')
        .insert({
          id: entityData.id, // Use same ID from entities table
          name: newCondoName.trim(),
        });

      if (condoError) {
        console.warn('[GenerateProtocolModal] Error creating in condominiums table:', condoError);
        // Continue anyway - entity was created successfully
      }

      // Link to contact if we have one
      if (contactId && entityData) {
        await supabase.from('contact_condominiums').insert({
          contact_id: contactId,
          condominium_id: entityData.id,
          is_default: true,
        });
      }

      toast.success('Condomínio criado!');
      setCondominiumId(entityData.id);
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
      // Verify user session first
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session) {
        throw new Error('Sessão expirada. Por favor, faça login novamente.');
      }

      // Get current user id
      const resolvedUserId = currentUserId ?? session.user.id;
      if (!resolvedUserId) {
        throw new Error('Usuário não autenticado');
      }

      // Get condominium name for notification
      const selectedCondo = availableCondominiums.find(c => c.id === condominiumId);

      console.log('[GenerateProtocolModal] Calling create-protocol with:', {
        conversation_id: conversationId,
        condominium_id: condominiumId,
        participant_id: participant?.id,
      });

      // Call backend to create protocol with idempotency
      const { data, error } = await supabase.functions.invoke('create-protocol', {
        body: {
          conversation_id: conversationId,
          condominium_id: condominiumId,
          summary: summary || null,
          notify_group: notifyGroup,
          participant_id: participant?.id || null,
          template_id: selectedTemplateId === 'auto' ? suggestedTemplateId : selectedTemplateId,
          requester_name: participant?.name || null,
          requester_role: participant?.role_type || null,
          contact_id: contactId,
          created_by_agent_id: resolvedUserId,
        },
      });

      if (error) {
        console.error('Error invoking create-protocol:', error);
        throw new Error(error.message || 'Erro ao criar protocolo');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Erro desconhecido ao criar protocolo');
      }

      const protocolCode = data.protocol.protocol_code;

      // If protocol already existed, just notify and close
      if (data.already_existed) {
        toast.info(`Esta conversa já possui o protocolo ${protocolCode}`);
        onOpenChange(false);
        return;
      }

      // Update conversation to assign to current user and reactivate AI
      const nowIso = new Date().toISOString();
      const { error: conversationUpdateError } = await supabase
        .from('conversations')
        .update({
          assigned_to: resolvedUserId,
          assigned_at: nowIso,
          assigned_by: resolvedUserId,
          active_condominium_set_by: 'human',
          active_condominium_set_at: nowIso,
          // Reactivate AI after protocol creation (service is complete)
          ai_mode: 'AUTO',
          human_control: false,
          ai_paused_until: null,
        })
        .eq('id', conversationId);

      if (conversationUpdateError) {
        console.error('Error updating conversation:', conversationUpdateError);
        // Don't throw - protocol was created successfully
      }

      // Log AI reactivation event
      await supabase.from('ai_events').insert({
        conversation_id: conversationId,
        event_type: 'ai_reactivated',
        message: '🤖 IA reativada após criação de protocolo.',
        metadata: { reason: 'protocol_created', protocol_code: protocolCode },
      });

      // Log protocol creation event
      await supabase.from('ai_events').insert({
        conversation_id: conversationId,
        event_type: 'protocol_created',
        message: `📋 Protocolo ${protocolCode} criado manualmente.`,
        metadata: { protocol_id: data.protocol.id, notify_group: notifyGroup },
      });

      toast.success(`Protocolo ${protocolCode} criado!`);
      onProtocolCreated?.(protocolCode);
      onOpenChange(false);
    } catch (error) {
      console.error('[GenerateProtocolModal] Error creating protocol:', error);

      let errorMessage = 'Erro ao criar protocolo';

      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        const err = error as any;
        if (err.message) {
          errorMessage = err.message;
        } else if (err.error) {
          errorMessage = err.error;
        }
      }

      toast.error(errorMessage);
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
                  autoFocus
                />
                <Button onClick={handleCreateCondominium} disabled={creatingCondo} size="sm">
                  {creatingCondo ? 'Salvando...' : 'Salvar'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  setShowNewCondoForm(false);
                  setNewCondoName('');
                }}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select
                  value={condominiumId}
                  onValueChange={setCondominiumId}
                  disabled={loadingCondominiums}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={loadingCondominiums ? 'Carregando...' : 'Selecione ou busque o condomínio'} />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Search input inside dropdown */}
                    <div className="px-2 py-1.5 border-b sticky top-0 bg-background z-10">
                      <Input
                        placeholder="🔍 Buscar condomínio..."
                        value={newCondoName}
                        onChange={(e) => setNewCondoName(e.target.value)}
                        className="h-8 text-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {(() => {
                      // Filter condominiums based on search
                      const searchTerm = newCondoName.toLowerCase().trim();
                      const filtered = searchTerm
                        ? availableCondominiums.filter(c =>
                          c.name.toLowerCase().includes(searchTerm)
                        )
                        : availableCondominiums;

                      if (filtered.length === 0 && searchTerm) {
                        // No results found - show option to create
                        return (
                          <div className="p-3 text-center">
                            <p className="text-sm text-muted-foreground mb-2">
                              Nenhum resultado para "<strong>{newCondoName}</strong>"
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => {
                                setShowNewCondoForm(true);
                              }}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Cadastrar "{newCondoName}"
                            </Button>
                          </div>
                        );
                      }

                      if (filtered.length === 0 && !searchTerm) {
                        return (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            Nenhum condomínio cadastrado
                          </div>
                        );
                      }

                      return filtered.map((condo) => (
                        <SelectItem
                          key={condo.id}
                          value={condo.id}
                          onClick={() => setNewCondoName('')}
                        >
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4" />
                            {condo.name}
                          </div>
                        </SelectItem>
                      ));
                    })()}
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

          {/* Template Selection */}
          <div className="grid gap-2">
            <Label>Template de Trabalho</Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  Auto (Sugerido: {templates.find(t => t.id === suggestedTemplateId)?.title || 'Básico'})
                </SelectItem>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              {selectedTemplateId === 'auto' ? (
                <>✨ Seleção automática via palavras-chave</>
              ) : (
                <>✋ Seleção manual (sobrescreve automático)</>
              )}
            </p>
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
