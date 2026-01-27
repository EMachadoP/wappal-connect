import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Calendar, Building2, Plus, Search } from 'lucide-react';

interface PlanItem {
    id: string;
    plan_date: string;
    start_minute: number;
    end_minute: number;
    technician_id: string;
    protocol_id: string;
    condominium_id: string | null;
    condominium_name: string | null;
    protocol_summary: string | null;
}

interface Condominium {
    id: string;
    name: string;
}

interface Technician {
    id: string;
    name: string;
}

interface EditPlanItemModalProps {
    item: PlanItem | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
    technicians: Technician[];
}

export function EditPlanItemModal({ item, open, onOpenChange, onSaved, technicians }: EditPlanItemModalProps) {
    const [loading, setLoading] = useState(false);
    const [condoName, setCondoName] = useState('');
    const [summary, setSummary] = useState('');
    const [date, setDate] = useState('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [techId, setTechId] = useState('');

    // Condominium state
    const [condominiums, setCondominiums] = useState<Condominium[]>([]);
    const [condominiumId, setCondominiumId] = useState<string>('');
    const [loadingCondos, setLoadingCondos] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showNewCondoForm, setShowNewCondoForm] = useState(false);
    const [newCondoName, setNewCondoName] = useState('');

    useEffect(() => {
        if (item) {
            setCondoName(item.condominium_name || '');
            setSummary(item.protocol_summary || '');
            setDate(item.plan_date);
            setStartTime(minutesToTime(item.start_minute));
            setEndTime(minutesToTime(item.end_minute));
            setTechId(item.technician_id);
            setCondominiumId(item.condominium_id || '');
            fetchCondominiums();
        }
    }, [item]);

    const fetchCondominiums = async () => {
        setLoadingCondos(true);
        try {
            const { data } = await supabase
                .from('entities')
                .select('id, name')
                .eq('type', 'condominio')
                .order('name');
            setCondominiums(data || []);
        } catch (err) {
            console.error('Error fetching condos:', err);
        } finally {
            setLoadingCondos(false);
        }
    };

    const handleCreateCondominium = async () => {
        if (!newCondoName.trim()) return;
        setLoading(true);
        try {
            const { data: entityData, error: entityError } = await supabase
                .from('entities')
                .insert({ name: newCondoName.trim(), type: 'condominio' })
                .select().single();
            if (entityError) throw entityError;

            await supabase.from('condominiums').insert({ id: entityData.id, name: newCondoName.trim() });

            toast.success('Condomínio cadastrado!');
            setCondominiumId(entityData.id);
            setShowNewCondoForm(false);
            setNewCondoName('');
            await fetchCondominiums();
        } catch (err) {
            console.error('Error creating condo:', err);
            toast.error('Erro ao cadastrar condomínio');
        } finally {
            setLoading(false);
        }
    };

    const minutesToTime = (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const timeToMinutes = (time: string) => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    };

    const handleSave = async () => {
        if (!item) return;

        setLoading(true);
        try {
            // Update plan_item date/time/technician
            const { error: planError } = await supabase
                .from('plan_items' as any)
                .update({
                    plan_date: date,
                    technician_id: techId,
                    condominium_id: condominiumId || null,
                    manual_title: condominiumId ? null : condoName, // Prioritize formal link
                    start_minute: timeToMinutes(startTime),
                    end_minute: timeToMinutes(endTime),
                })
                .eq('id', item.id);

            if (planError) throw planError;

            // Update protocol summary and condominium name
            if (summary !== item.protocol_summary || condoName !== item.condominium_name) {
                const { error: protocolError } = await supabase
                    .from('protocols')
                    .update({
                        summary,
                        condominium_name: condoName
                    })
                    .eq('id', item.protocol_id);

                if (protocolError) throw protocolError;
            }

            toast.success('Agendamento atualizado!');
            onSaved();
            onOpenChange(false);
        } catch (err: any) {
            console.error('Error updating plan item:', err);
            toast.error(`Erro ao atualizar: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Editar Agendamento</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="tech">Técnico Responsável</Label>
                        <select
                            id="tech"
                            value={techId}
                            onChange={(e) => setTechId(e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {technicians.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid gap-2">
                        <Label>Condomínio</Label>
                        {showNewCondoForm ? (
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Nome do novo condomínio"
                                    value={newCondoName}
                                    onChange={(e) => setNewCondoName(e.target.value)}
                                    className="flex-1"
                                    autoFocus
                                />
                                <Button onClick={handleCreateCondominium} disabled={loading} size="sm">
                                    Salvar
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setShowNewCondoForm(false)}>
                                    Cancelar
                                </Button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <select
                                    value={condominiumId}
                                    onChange={(e) => setCondominiumId(e.target.value)}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <option value="">-- Selecione ou use título manual --</option>
                                    {condominiums.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                                <Button variant="outline" size="icon" onClick={() => setShowNewCondoForm(true)}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        )}

                        {!condominiumId && !showNewCondoForm && (
                            <Input
                                id="condo"
                                value={condoName}
                                onChange={(e) => setCondoName(e.target.value)}
                                placeholder="Ou digite um título manual..."
                                className="mt-1"
                            />
                        )}
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="summary">Problema / Resumo</Label>
                        <Textarea
                            id="summary"
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            placeholder="Descreva o problema..."
                            rows={3}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="date">Data</Label>
                            <div className="relative">
                                <Input
                                    id="date"
                                    type="date"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                />
                                <Calendar className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="time">Horário</Label>
                            <div className="flex gap-2 items-center">
                                <Input
                                    type="time"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    className="w-full"
                                />
                                <span>→</span>
                                <Input
                                    type="time"
                                    value={endTime}
                                    onChange={(e) => setEndTime(e.target.value)}
                                    className="w-full"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
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
