import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Calendar, Clock, Users, Wrench } from 'lucide-react';

interface Technician {
    id: string;
    name: string;
}

interface CreateManualItemModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
    technicians: Technician[];
    defaultDate?: string;
    defaultTechnicianId?: string;
}

export function CreateManualItemModal({
    open,
    onOpenChange,
    onSaved,
    technicians,
    defaultDate,
    defaultTechnicianId
}: CreateManualItemModalProps) {
    const [loading, setLoading] = useState(false);
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [date, setDate] = useState(defaultDate || '');
    const [startTime, setStartTime] = useState('08:00');
    const [duration, setDuration] = useState('60');
    const [selectedTechs, setSelectedTechs] = useState<string[]>(
        defaultTechnicianId ? [defaultTechnicianId] : []
    );
    const [isFixed, setIsFixed] = useState(true);
    const [itemType, setItemType] = useState<'installation' | 'service'>('installation');

    useEffect(() => {
        if (open) {
            setDate(defaultDate || new Date().toISOString().split('T')[0]);
            setSelectedTechs(defaultTechnicianId ? [defaultTechnicianId] : []);
        }
    }, [open, defaultDate, defaultTechnicianId]);

    const timeToMinutes = (time: string) => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    };

    const handleTechToggle = (techId: string) => {
        setSelectedTechs(prev =>
            prev.includes(techId)
                ? prev.filter(id => id !== techId)
                : [...prev, techId]
        );
    };

    const handleSave = async () => {
        if (!title.trim()) {
            toast.error('Informe o título/condomínio');
            return;
        }
        if (!date) {
            toast.error('Selecione uma data');
            return;
        }
        if (selectedTechs.length === 0) {
            toast.error('Selecione pelo menos um técnico');
            return;
        }

        setLoading(true);
        try {
            const startMinute = timeToMinutes(startTime);
            const endMinute = startMinute + parseInt(duration);
            const groupId = selectedTechs.length > 1 ? crypto.randomUUID() : null;

            // Criar um plan_item para cada técnico selecionado
            const items = selectedTechs.map((techId, index) => ({
                plan_date: date,
                technician_id: techId,
                start_minute: startMinute,
                end_minute: endMinute,
                sequence: index,
                source: 'manual',
                manual_title: title,
                manual_notes: notes || null,
                is_fixed: isFixed,
                assignment_group_id: groupId,
                work_item_id: null
            }));

            const { error } = await supabase
                .from('plan_items' as any)
                .insert(items);

            if (error) throw error;

            toast.success(`${itemType === 'installation' ? 'Instalação' : 'Serviço'} agendado!`);
            onSaved();
            onOpenChange(false);

            // Reset form
            setTitle('');
            setNotes('');
            setSelectedTechs([]);
        } catch (err: any) {
            console.error('Error creating manual item:', err);
            toast.error(`Erro ao criar: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[550px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Wrench className="h-5 w-5" />
                        Novo Agendamento Manual
                    </DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* Tipo */}
                    <div className="grid gap-2">
                        <Label>Tipo de Serviço</Label>
                        <Select value={itemType} onValueChange={(v: any) => setItemType(v)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="installation">🔧 Instalação</SelectItem>
                                <SelectItem value="service">🛠️ Manutenção/Serviço</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Título / Condomínio */}
                    <div className="grid gap-2">
                        <Label htmlFor="title">Condomínio / Título *</Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Ex: Residencial Porto Seguro - Instalação CFTV"
                        />
                    </div>

                    {/* Notas */}
                    <div className="grid gap-2">
                        <Label htmlFor="notes">Observações</Label>
                        <Textarea
                            id="notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Detalhes do serviço, materiais necessários..."
                            rows={2}
                        />
                    </div>

                    {/* Data e Horário */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="grid gap-2">
                            <Label className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" /> Data *
                            </Label>
                            <Input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label className="flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Início
                            </Label>
                            <Input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Duração</Label>
                            <Select value={duration} onValueChange={setDuration}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="30">30 min</SelectItem>
                                    <SelectItem value="60">1 hora</SelectItem>
                                    <SelectItem value="90">1h30</SelectItem>
                                    <SelectItem value="120">2 horas</SelectItem>
                                    <SelectItem value="180">3 horas</SelectItem>
                                    <SelectItem value="240">4 horas</SelectItem>
                                    <SelectItem value="300">5 horas</SelectItem>
                                    <SelectItem value="360">6 horas</SelectItem>
                                    <SelectItem value="480">8 horas (dia todo)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Técnicos */}
                    <div className="grid gap-2">
                        <Label className="flex items-center gap-1">
                            <Users className="h-3 w-3" /> Técnicos *
                        </Label>
                        <div className="grid grid-cols-2 gap-2 p-3 border rounded-lg bg-muted/20">
                            {technicians.map((tech) => (
                                <div key={tech.id} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={tech.id}
                                        checked={selectedTechs.includes(tech.id)}
                                        onCheckedChange={() => handleTechToggle(tech.id)}
                                    />
                                    <label
                                        htmlFor={tech.id}
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                    >
                                        {tech.name}
                                    </label>
                                </div>
                            ))}
                        </div>
                        {selectedTechs.length > 1 && (
                            <p className="text-xs text-muted-foreground">
                                ⚠️ {selectedTechs.length} técnicos selecionados - será criado um agendamento em equipe
                            </p>
                        )}
                    </div>

                    {/* Fixo */}
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="isFixed"
                            checked={isFixed}
                            onCheckedChange={(checked) => setIsFixed(!!checked)}
                        />
                        <label htmlFor="isFixed" className="text-sm">
                            📌 Horário fixo (não será movido pelo planejamento automático)
                        </label>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={loading}>
                        {loading ? 'Salvando...' : 'Criar Agendamento'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
