import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar, Clock, User, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { callFunction } from '@/lib/supabaseFunctions';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface CreateTaskModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    conversationId?: string;
    defaultTitle?: string;
    onTaskCreated?: () => void;
}

// Profile for assignee selection (directly from profiles table)
interface Profile {
    id: string;
    name: string;
}

const UNASSIGNED = '__unassigned__';

export function CreateTaskModal({
    open,
    onOpenChange,
    conversationId,
    defaultTitle = '',
    onTaskCreated,
}: CreateTaskModalProps) {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [profiles, setProfiles] = useState<Profile[]>([]);

    // Form state
    const [title, setTitle] = useState(defaultTitle);
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
    const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
    const [dueDate, setDueDate] = useState('');
    const [dueTime, setDueTime] = useState('18:00');
    const [assignConversation, setAssignConversation] = useState(true);

    useEffect(() => {
        if (open) {
            setTitle(defaultTitle);
            setDescription('');
            setPriority('normal');
            setAssigneeId(user?.id || UNASSIGNED);
            setDueDate('');
            setDueTime('18:00');
            setAssignConversation(true);
        }
    }, [open, defaultTitle, user?.id]);

    // Fetch profiles (assignees) on mount - directly from profiles table
    useEffect(() => {
        const fetchProfiles = async () => {
            const { data } = await supabase
                .from('profiles')
                .select('id, name')
                .eq('is_active', true)  // ✅ FIX: Use correct column name
                .order('name');

            if (data) setProfiles(data);
        };
        fetchProfiles();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title.trim()) {
            toast.error('Título é obrigatório');
            return;
        }

        setLoading(true);

        try {
            // Build due_at timestamp
            let dueAt: string | null = null;
            if (dueDate) {
                dueAt = new Date(`${dueDate}T${dueTime || '18:00'}:00`).toISOString();
            }

            // assignee_id is now directly profiles.id (no translation needed)
            const actualAssigneeId = assigneeId === UNASSIGNED ? null : assigneeId;

            // Use callFunction helper with explicit apikey + Authorization
            const data = await callFunction<{ task: any }>('create-task', {
                title: title.trim(),
                description: description.trim() || null,
                priority,
                assignee_id: actualAssigneeId, // Direct profiles.id
                conversation_id: conversationId || null,
                due_at: dueAt,
                assign_conversation: assignConversation && !!conversationId && !!actualAssigneeId,
            });

            console.log('[create-task] Success:', data.task?.id);

            toast.success('Tarefa criada com sucesso!');
            onOpenChange(false);
            onTaskCreated?.();
        } catch (err) {
            console.error('Error creating task:', err);
            toast.error('Erro ao criar tarefa');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Criar Tarefa
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Preencha os dados da tarefa e defina prazo, prioridade e responsável.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Título */}
                    <div className="space-y-2">
                        <Label htmlFor="title">Título *</Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Ex: Fazer orçamento de câmeras"
                            autoFocus
                        />
                    </div>

                    {/* Descrição */}
                    <div className="space-y-2">
                        <Label htmlFor="description">Descrição</Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Detalhes adicionais..."
                            rows={3}
                        />
                    </div>

                    {/* Prioridade e Responsável */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Prioridade</Label>
                            <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="low">🟢 Baixa</SelectItem>
                                    <SelectItem value="normal">🔵 Normal</SelectItem>
                                    <SelectItem value="high">🟠 Alta</SelectItem>
                                    <SelectItem value="urgent">🔴 Urgente</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Responsável</Label>
                            <Select value={assigneeId} onValueChange={setAssigneeId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={UNASSIGNED}>Não atribuído</SelectItem>
                                    {profiles.map((profile) => (
                                        <SelectItem key={profile.id} value={profile.id}>
                                            <span className="flex items-center gap-2">
                                                <User className="h-3 w-3" />
                                                {profile.name}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Data e Hora */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="dueDate">Prazo (Data)</Label>
                            <Input
                                id="dueDate"
                                type="date"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="dueTime">Horário</Label>
                            <Input
                                id="dueTime"
                                type="time"
                                value={dueTime}
                                onChange={(e) => setDueTime(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Atribuir conversa também */}
                    {conversationId && (
                        <div className="flex items-center space-x-2 p-3 bg-muted rounded-lg">
                            <Checkbox
                                id="assignConversation"
                                checked={assignConversation}
                                onCheckedChange={(checked) => setAssignConversation(!!checked)}
                            />
                            <Label htmlFor="assignConversation" className="text-sm cursor-pointer">
                                Atribuir também a conversa ao responsável
                            </Label>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Criando...' : 'Criar Tarefa'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
