import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
}

interface IdentifyParticipantModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  conversationId: string;
  existingParticipant?: Participant | null;
  onSaved: () => void;
}

const ROLE_TYPES = [
  { value: 'sindico', label: 'Síndico' },
  { value: 'subsindico', label: 'Subsíndico' },
  { value: 'porteiro', label: 'Porteiro' },
  { value: 'zelador', label: 'Zelador' },
  { value: 'morador', label: 'Morador' },
  { value: 'administrador', label: 'Administrador' },
  { value: 'conselheiro', label: 'Conselheiro' },
  { value: 'funcionario', label: 'Funcionário' },
  { value: 'supervisor_condominial', label: 'Supervisor Condominial' },
  { value: 'visitante', label: 'Visitante' },
  { value: 'prestador', label: 'Prestador de Serviço' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'outro', label: 'Outro' },
];

export function IdentifyParticipantModal({
  open,
  onOpenChange,
  contactId,
  conversationId,
  existingParticipant,
  onSaved,
}: IdentifyParticipantModalProps) {
  const [name, setName] = useState('');
  const [roleType, setRoleType] = useState<string>('');
  const [entityId, setEntityId] = useState<string>('');
  const [newEntityName, setNewEntityName] = useState('');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);
  const [createNewEntity, setCreateNewEntity] = useState(false);

  useEffect(() => {
    if (open) {
      fetchEntities();
      if (existingParticipant) {
        setName(existingParticipant.name);
        setRoleType(existingParticipant.role_type || '');
        setEntityId(existingParticipant.entity_id || '');
      } else {
        setName('');
        setRoleType('');
        setEntityId('');
      }
      setNewEntityName('');
      setCreateNewEntity(false);
    }
  }, [open, existingParticipant]);

  const fetchEntities = async () => {
    const { data } = await supabase
      .from('entities')
      .select('*')
      .order('name');
    if (data) setEntities(data);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setLoading(true);

    try {
      let finalEntityId = entityId;

      // Create new entity if requested
      if (createNewEntity && newEntityName.trim()) {
        const { data: newEntity, error: entityError } = await supabase
          .from('entities')
          .insert({ name: newEntityName.trim(), type: 'condominio' })
          .select()
          .single();

        if (entityError) throw entityError;
        finalEntityId = newEntity.id;
      }

      if (existingParticipant) {
        // Update existing participant
        const { error } = await supabase
          .from('participants')
          .update({
            name: name.trim(),
            role_type: roleType || null,
            entity_id: finalEntityId || null,
            confidence: 1.0, // User confirmed
          })
          .eq('id', existingParticipant.id);

        if (error) throw error;
      } else {
        // Create new participant
        const { data: newParticipant, error } = await supabase
          .from('participants')
          .insert({
            contact_id: contactId,
            name: name.trim(),
            role_type: roleType || null,
            entity_id: finalEntityId || null,
            confidence: 1.0,
            is_primary: true,
          })
          .select()
          .single();

        if (error) throw error;

        // Update conversation_participant_state
        await supabase
          .from('conversation_participant_state')
          .upsert({
            conversation_id: conversationId,
            current_participant_id: newParticipant.id,
            last_confirmed_at: new Date().toISOString(),
            identification_asked: true,
          }, { onConflict: 'conversation_id' });
      }

      toast.success('Remetente identificado com sucesso');
      onSaved();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving participant:', error);
      toast.error('Erro ao salvar identificação');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Identificar Remetente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome da pessoa"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Função</Label>
            <Select value={roleType} onValueChange={setRoleType}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma função" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_TYPES.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="entity">Condomínio / Empresa</Label>
            {createNewEntity ? (
              <div className="flex gap-2">
                <Input
                  value={newEntityName}
                  onChange={(e) => setNewEntityName(e.target.value)}
                  placeholder="Nome do condomínio/empresa"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateNewEntity(false)}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((entity) => (
                      <SelectItem key={entity.id} value={entity.id}>
                        {entity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateNewEntity(true)}
                >
                  Novo
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
