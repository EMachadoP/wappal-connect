import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Calendar } from 'lucide-react';

interface PlanItem {
    id: string;
    plan_date: string;
    start_minute: number;
    end_minute: number;
    protocol_id: string;
    condominium_name: string | null;
    protocol_summary: string | null;
}

interface EditPlanItemModalProps {
    item: PlanItem | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

export function EditPlanItemModal({ item, open, onOpenChange, onSaved }: EditPlanItemModalProps) {
    const [loading, setLoading] = useState(false);
    const [condoName, setCondoName] = useState('');
    const [summary, setSummary] = useState('');
    const [date, setDate] = useState('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');

    useEffect(() => {
        if (item) {
            setCondoName(item.condominium_name || '');
            setSummary(item.protocol_summary || '');
            setDate(item.plan_date);
            setStartTime(minutesToTime(item.start_minute));
            setEndTime(minutesToTime(item.end_minute));
        }
    }, [item]);

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
            // Update plan_item date/time
            const { error: planError } = await supabase
                .from('plan_items' as any)
                .update({
                    plan_date: date,
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
                        <Label htmlFor="condo">Nome do Condomínio</Label>
                        <Input
                            id="condo"
                            value={condoName}
                            onChange={(e) => setCondoName(e.target.value)}
                            placeholder="Ex: Residencial São Paulo"
                        />
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
