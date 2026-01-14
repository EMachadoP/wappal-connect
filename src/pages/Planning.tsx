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
    GripVertical,
} from 'lucide-react';
import { format, addDays, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';

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
    protocol_summary: string | null;
    condominium_name: string | null;
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

// --- DnD Components ---

interface SortableItemProps {
    item: PlanItem;
    openConversation: (id: string) => void;
    handleUpdateStatus: (itemId: string, status: string, e: React.MouseEvent) => void;
    otherTechs: string[];
}

const SortableItem = ({ item, openConversation, handleUpdateStatus, otherTechs }: SortableItemProps) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.id, data: item });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.3 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`p-2 rounded text-xs cursor-pointer hover:shadow-md transition-all border group ${priorityColors[item.work_item_priority || 'normal']} ${statusStyles[item.work_item_status || 'open']}`}
            onClick={() => openConversation(item.conversation_id || '')}
            title={`${item.protocol_code || ''} - Clique para abrir conversa`}
        >
            <div className="flex items-center justify-between gap-1 mb-1">
                <div className="flex items-center gap-1">
                    <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-black/5 rounded">
                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <Clock className="h-3 w-3" />
                    <span className="font-medium">
                        {minutesToTime(item.start_minute)} - {minutesToTime(item.end_minute)}
                    </span>
                </div>
                {item.work_item_status === 'done' && <CheckCircle className="h-3 w-3 text-green-600" />}
            </div>

            {/* Rich Card Content */}
            <div className="text-sm font-semibold truncate">
                {item.condominium_name || 'Condomínio não identificado'}
            </div>
            <div className="text-[11px] text-muted-foreground line-clamp-2 leading-tight mb-1">
                {item.protocol_summary || item.work_item_title}
            </div>
            <div className="text-[10px] opacity-70 flex justify-between items-center">
                <span>{item.protocol_code}</span>
                <span className="font-medium">
                    {minutesToTime(item.start_minute)}
                </span>
            </div>

            {item.assignment_group_id && (
                <div className="mb-2 flex items-center gap-1 text-[10px] opacity-70 italic border-t border-black/5 pt-1">
                    <Users className="h-3 w-3" />
                    <span>{otherTechs.join(', ') || 'Equipe'}</span>
                </div>
            )}

            {/* Action Buttons */}
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
    );
};

interface DroppableCellProps {
    id: string; // techId:dateStr
    children: React.ReactNode;
}

const DroppableCell = ({ id, children }: DroppableCellProps) => {
    const { setNodeRef, isOver } = useDroppable({ id });

    return (
        <td
            ref={setNodeRef}
            className={`border p-1 align-top min-h-[100px] transition-colors ${isOver ? 'bg-primary/10' : ''}`}
        >
            <div className="space-y-1 min-h-[40px]">
                {children}
            </div>
        </td>
    );
};

export default function Planning() {
    const navigate = useNavigate();
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [planItems, setPlanItems] = useState<PlanItem[]>([]);
    const [technicians, setTechnicians] = useState<Technician[]>([]);
    const [loading, setLoading] = useState(true);
    const [rebuilding, setRebuilding] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const startDate = format(weekStart, 'yyyy-MM-dd');
            const endDate = format(addDays(weekStart, 6), 'yyyy-MM-dd');

            const { data: techData } = await supabase
                .from('technicians' as any)
                .select('id, name')
                .eq('is_active', true)
                .order('name');

            setTechnicians((techData as unknown as Technician[]) || []);

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
        const channel = supabase
            .channel('planning-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'protocol_work_items' }, () => fetchData())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_items' }, () => fetchData())
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchData]);

    const handleUpdateStatus = async (itemId: string, status: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const updates: any = { status };
            if (status === 'in_progress') updates.started_at = new Date().toISOString();
            if (status === 'done') updates.completed_at = new Date().toISOString();

            const { error } = await supabase.from('protocol_work_items' as any).update(updates).eq('id', itemId);
            if (error) throw error;
            toast.success(`Status atualizado`);
            fetchData();
        } catch (error: any) {
            toast.error('Erro ao atualizar status');
        }
    };

    const handleDragStart = (event: any) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = async (event: any) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const draggedId = active.id;
        const [targetTechId, targetDate] = over.id.split(':');

        const originalItem = planItems.find(i => i.id === draggedId);
        if (!originalItem) return;

        // If dropped on the same spot, do nothing
        if (originalItem.technician_id === targetTechId && originalItem.plan_date === targetDate) return;

        try {
            // Optimistic update
            const updatedItems = planItems.map(item => {
                if (item.id === draggedId || (item.assignment_group_id && item.assignment_group_id === originalItem.assignment_group_id)) {
                    return { ...item, technician_id: targetTechId, plan_date: targetDate };
                }
                return item;
            });
            setPlanItems(updatedItems);

            // Persist to DB
            const { error } = await supabase
                .from('plan_items' as any)
                .update({
                    technician_id: targetTechId,
                    plan_date: targetDate
                })
                .match({ id: draggedId });

            if (error) throw error;

            // If it's a group (2 technicians), we might want to move both, but user MVP only asked for basic DND
            // For now, let's just move the dragged one.

            toast.success('Agendamento movido');
        } catch (err) {
            console.error('Error moving item:', err);
            toast.error('Erro ao mover agendamento');
            fetchData(); // Rollback
        }
    };

    const handleRebuildPlan = async () => {
        setRebuilding(true);
        try {
            const startDate = format(weekStart, 'yyyy-MM-dd');
            const { data, error } = await supabase.functions.invoke('rebuild-plan', {
                body: { start_date: startDate, days: 7 },
            });
            if (error) throw error;
            toast.success(`Planejamento gerado! ${data?.scheduled || 0} itens agendados.`);
            fetchData();
        } catch (err: any) {
            toast.error(err?.message || 'Erro ao gerar planejamento');
        } finally {
            setRebuilding(false);
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

    const activeItem = activeId ? planItems.find(i => i.id === activeId) : null;

    return (
        <AppLayout>
            <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Calendar className="h-6 w-6" />
                            Planejamento
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            Semana de {format(weekStart, "d 'de' MMMM", { locale: ptBR })}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={() => setWeekStart(prev => addDays(prev, -7))}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
                            Hoje
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => setWeekStart(prev => addDays(prev, 7))}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>

                        <Button onClick={handleRebuildPlan} disabled={rebuilding}>
                            <RefreshCw className={`h-4 w-4 mr-2 ${rebuilding ? 'animate-spin' : ''}`} />
                            {rebuilding ? 'Gerando...' : 'Gerar Planejamento'}
                        </Button>
                    </div>
                </div>

                {loading ? (
                    <Card><CardContent className="py-8 text-center text-muted-foreground">Carregando...</CardContent></Card>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="overflow-x-auto rounded-lg border bg-card">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr>
                                        <th className="border-b p-3 bg-muted/50 text-left w-40 font-bold">Técnico</th>
                                        {weekDays.map((day) => (
                                            <th key={day.toISOString()} className="border-b border-l p-3 bg-muted/50 text-center min-w-[180px]">
                                                <div className="font-bold">{format(day, 'EEEE', { locale: ptBR })}</div>
                                                <div className="text-xs text-muted-foreground">{format(day, 'd/MM')}</div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {technicians.map((tech) => (
                                        <tr key={tech.id} className="group">
                                            <td className="border-b p-3 font-bold bg-muted/20">
                                                <div className="flex items-center gap-2">
                                                    <Wrench className="h-4 w-4 text-primary" />
                                                    {tech.name}
                                                </div>
                                            </td>
                                            {weekDays.map((day) => {
                                                const dateStr = format(day, 'yyyy-MM-dd');
                                                const cellId = `${tech.id}:${dateStr}`;
                                                const items = getItemsForCell(tech.id, dateStr);

                                                return (
                                                    <DroppableCell key={cellId} id={cellId}>
                                                        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                                            {items.map((item) => (
                                                                <SortableItem
                                                                    key={item.id}
                                                                    item={item}
                                                                    openConversation={(id) => navigate(`/inbox/${id}`)}
                                                                    handleUpdateStatus={handleUpdateStatus}
                                                                    otherTechs={getOtherTechs(item)}
                                                                />
                                                            ))}
                                                        </SortableContext>
                                                    </DroppableCell>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <DragOverlay dropAnimation={{
                            sideEffects: defaultDropAnimationSideEffects({
                                styles: {
                                    active: {
                                        opacity: '0.5',
                                    },
                                },
                            }),
                        }}>
                            {activeItem ? (
                                <div className={`p-2 rounded text-xs border shadow-xl w-[170px] ${priorityColors[activeItem.work_item_priority || 'normal']}`}>
                                    <div className="font-bold">{activeItem.condominium_name}</div>
                                    <div className="opacity-70">{activeItem.protocol_code}</div>
                                </div>
                            ) : null}
                        </DragOverlay>
                    </DndContext>
                )}

                {!loading && (
                    <div className="flex items-center gap-4 text-sm text-muted-foreground p-2 bg-muted/10 rounded-lg">
                        <Users className="h-4 w-4" />
                        <span>{technicians.length} técnicos ativos</span>
                        <Calendar className="h-4 w-4 ml-4" />
                        <span>{planItems.length} itens agendados</span>
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
