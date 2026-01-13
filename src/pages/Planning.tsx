import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Calendar,
    Clock,
    User,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    Wrench,
    AlertCircle,
    Users,
    Play,
    CheckCircle,
    Pause,
} from 'lucide-react';
import { format, addDays, startOfWeek, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

// Interface matches v_planning_week VIEW
interface PlanItem {
    id: string;
    plan_date: string;
    start_minute: number;
    end_minute: number;
    sequence: number;
    technician_id: string;
    technician_name: string;
    work_item_id: string;
    work_item_title: string;
    work_item_priority: string;
    work_item_category: string;
    work_item_status: string;
    estimated_minutes: number;
    protocol_id: string;
    protocol_code: string;
    conversation_id: string;
    assignment_group_id: string | null;
}

interface Technician {
    id: string;
    name: string;
}

const priorityColors: Record<string, string> = {
    urgent: 'border-red-400 bg-red-50 text-red-900',
    high: 'border-orange-400 bg-orange-50 text-orange-900',
    normal: 'border-blue-300 bg-blue-50 text-blue-900',
    low: 'border-gray-300 bg-gray-50 text-gray-700',
};

const statusStyles: Record<string, string> = {
    open: 'border-opacity-100',
    in_progress: 'border-amber-500 border-2 bg-amber-50 shadow-sm',
    done: 'opacity-50 grayscale bg-green-50 border-green-200',
    blocked: 'border-rose-500 bg-rose-50 border-2',
};

function minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function Planning() {
    const navigate = useNavigate();
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [planItems, setPlanItems] = useState<PlanItem[]>([]);
    const [technicians, setTechnicians] = useState<Technician[]>([]);
    const [loading, setLoading] = useState(true);
    const [rebuilding, setRebuilding] = useState(false);

    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const startDate = format(weekStart, 'yyyy-MM-dd');
            const endDate = format(addDays(weekStart, 6), 'yyyy-MM-dd');

            // Fetch technicians
            const { data: techData } = await supabase
                .from('technicians' as any)
                .select('id, name')
                .eq('is_active', true)
                .order('name');

            setTechnicians((techData as unknown as Technician[]) || []);

            // Fetch plan items from VIEW (simpler, faster)
            const { data: planData } = await supabase
                .from('v_planning_week' as any)
                .select('*')
                .gte('plan_date', startDate)
                .lte('plan_date', endDate)
                .order('start_minute', { ascending: true });

            setPlanItems((planData as unknown as PlanItem[]) || []);
        } catch (err) {
            console.error('Error fetching planning data:', err);
            toast.error('Erro ao carregar planejamento');
        } finally {
            setLoading(false);
        }
    }, [weekStart]);

    useEffect(() => {
        fetchData();

        // Subscribe to work item changes to refresh the grid
        const channel = supabase
            .channel('planning-updates')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'protocol_work_items' },
                () => fetchData()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchData]);

    const handleUpdateStatus = async (itemId: string, status: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Don't open conversation
        try {
            const updates: any = { status };
            if (status === 'in_progress') updates.started_at = new Date().toISOString();
            if (status === 'done') updates.completed_at = new Date().toISOString();

            const { error } = await supabase
                .from('protocol_work_items' as any)
                .update(updates)
                .eq('id', itemId);

            if (error) throw error;
            toast.success(`Status atualizado para ${status}`);
            fetchData();
        } catch (error: any) {
            console.error('Error updating status:', error);
            toast.error('Erro ao atualizar status');
        }
    };

    const handleRebuildPlan = async () => {
        setRebuilding(true);
        try {
            const startDate = format(weekStart, 'yyyy-MM-dd');

            // Use supabase.functions.invoke for proper JWT auth
            const { data, error } = await supabase.functions.invoke('rebuild-plan', {
                body: { start_date: startDate, days: 7 },
            });

            if (error) throw error;

            toast.success(`Planejamento gerado! ${data?.scheduled || 0} itens agendados.`);
            fetchData();
        } catch (err: any) {
            console.error('Error rebuilding plan:', err);

            // Tenta extrair a resposta do servidor para depurar 403/500
            const ctx = err?.context;
            if (ctx?.response) {
                try {
                    const text = await ctx.response.text();
                    console.error('rebuild-plan response body:', text);
                } catch (e) {
                    console.error('Could not parse error response body');
                }
            }

            toast.error(err?.message || 'Erro ao gerar planejamento');
        } finally {
            setRebuilding(false);
        }
    };

    const handleWeekChange = (direction: 'prev' | 'next') => {
        setWeekStart(prev => addDays(prev, direction === 'next' ? 7 : -7));
    };

    const openConversation = (conversationId: string) => {
        if (conversationId) {
            navigate(`/inbox/${conversationId}`);
        }
    };

    const getItemsForCell = (techId: string, dateStr: string): PlanItem[] => {
        return planItems.filter(
            item => item.technician_id === techId && item.plan_date === dateStr
        ).sort((a, b) => a.start_minute - b.start_minute);
    };

    const getOtherTechs = (item: PlanItem) => {
        if (!item.assignment_group_id) return [];
        return planItems
            .filter(p => p.assignment_group_id === item.assignment_group_id && p.technician_id !== item.technician_id)
            .map(p => p.technician_name);
    };

    return (
        <AppLayout>
            <div className="p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Calendar className="h-6 w-6" />
                            Planejamento
                        </h1>
                        <p className="text-muted-foreground">
                            Semana de {format(weekStart, "d 'de' MMMM", { locale: ptBR })} a{' '}
                            {format(addDays(weekStart, 6), "d 'de' MMMM", { locale: ptBR })}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleWeekChange('prev')}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                        >
                            Hoje
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleWeekChange('next')}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>

                        <Button onClick={handleRebuildPlan} disabled={rebuilding}>
                            <RefreshCw className={`h-4 w-4 mr-2 ${rebuilding ? 'animate-spin' : ''}`} />
                            {rebuilding ? 'Gerando...' : 'Gerar Planejamento'}
                        </Button>
                    </div>
                </div>

                {/* Grid */}
                {loading ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            Carregando planejamento...
                        </CardContent>
                    </Card>
                ) : technicians.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center">
                            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="text-muted-foreground">
                                Nenhum técnico cadastrado. Adicione técnicos no banco de dados.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr>
                                    <th className="border p-2 bg-muted text-left w-32">
                                        <User className="h-4 w-4 inline mr-1" />
                                        Técnico
                                    </th>
                                    {weekDays.map((day) => (
                                        <th key={day.toISOString()} className="border p-2 bg-muted text-center min-w-[140px]">
                                            <div className="font-medium">
                                                {format(day, 'EEE', { locale: ptBR })}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                {format(day, 'd/MM')}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {technicians.map((tech) => (
                                    <tr key={tech.id}>
                                        <td className="border p-2 font-medium bg-muted/50">
                                            <div className="flex items-center gap-2">
                                                <Wrench className="h-4 w-4 text-muted-foreground" />
                                                {tech.name}
                                            </div>
                                        </td>
                                        {weekDays.map((day) => {
                                            const dateStr = format(day, 'yyyy-MM-dd');
                                            const items = getItemsForCell(tech.id, dateStr);

                                            return (
                                                <td key={dateStr} className="border p-1 align-top min-h-[80px]">
                                                    <div className="space-y-1">
                                                        {items.map((item) => (
                                                            <div
                                                                key={item.id}
                                                                className={`p-2 rounded text-xs cursor-pointer hover:shadow-md transition-all border group ${priorityColors[item.work_item_priority || 'normal']} ${statusStyles[item.work_item_status || 'open']}`}
                                                                onClick={() => openConversation(item.conversation_id || '')}
                                                                title={`${item.protocol_code || ''} - Clique para abrir conversa`}
                                                            >
                                                                <div className="flex items-center justify-between gap-1 mb-1">
                                                                    <div className="flex items-center gap-1">
                                                                        <Clock className="h-3 w-3" />
                                                                        <span className="font-medium">
                                                                            {minutesToTime(item.start_minute)} - {minutesToTime(item.end_minute)}
                                                                        </span>
                                                                    </div>
                                                                    {item.work_item_status === 'done' && <CheckCircle className="h-3 w-3 text-green-600" />}
                                                                </div>
                                                                <div className="font-semibold mb-1 truncate">
                                                                    {item.protocol_code}
                                                                </div>
                                                                <div className="truncate mb-2">
                                                                    {item.work_item_title || 'Sem título'}
                                                                </div>

                                                                {item.assignment_group_id && (
                                                                    <div className="mb-2 flex items-center gap-1 text-[10px] opacity-70 italic border-t border-black/5 pt-1">
                                                                        <Users className="h-3 w-3" />
                                                                        <span>{getOtherTechs(item).join(', ') || 'Equipe'}</span>
                                                                    </div>
                                                                )}

                                                                {/* Action Buttons - Visible on hover or if in_progress/blocked */}
                                                                <div className={`flex items-center gap-1 pt-1 border-t border-black/5 ${item.work_item_status === 'open' ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'} transition-opacity`}>
                                                                    {item.work_item_status !== 'done' && (
                                                                        <>
                                                                            {item.work_item_status !== 'in_progress' ? (
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="icon"
                                                                                    className="h-6 w-6 hover:bg-amber-100 text-amber-600"
                                                                                    onClick={(e) => handleUpdateStatus(item.work_item_id, 'in_progress', e)}
                                                                                    title="Iniciar"
                                                                                >
                                                                                    <Play className="h-3 w-3 fill-current" />
                                                                                </Button>
                                                                            ) : (
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="icon"
                                                                                    className="h-6 w-6 hover:bg-green-100 text-green-600"
                                                                                    onClick={(e) => handleUpdateStatus(item.work_item_id, 'done', e)}
                                                                                    title="Concluir"
                                                                                >
                                                                                    <CheckCircle className="h-3 w-3" />
                                                                                </Button>
                                                                            )}

                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-6 w-6 hover:bg-rose-100 text-rose-600"
                                                                                onClick={(e) => handleUpdateStatus(item.work_item_id, 'blocked', e)}
                                                                                title="Bloquear"
                                                                            >
                                                                                <Pause className="h-3 w-3" />
                                                                            </Button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Stats */}
                {!loading && (
                    <div className="flex gap-4 text-sm text-muted-foreground">
                        <span>{technicians.length} técnico(s)</span>
                        <span>•</span>
                        <span>{planItems.length} item(ns) agendado(s) esta semana</span>
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
