import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTasks, TaskPriority, formatSecondsToHM, useAgentMetrics } from '@/hooks/useTasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
    Calendar,
    Clock,
    AlertTriangle,
    CheckCircle,
    Play,
    User,
    ChevronRight,
    ArrowLeft,
    LayoutGrid,
    List,
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, addDays, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

const priorityIcons: Record<TaskPriority, string> = {
    low: '🟢',
    normal: '🔵',
    high: '🟠',
    urgent: '🔴',
};

export default function Agenda() {
    const { tasks, loading, startTask, completeTask } = useTasks({
        status: ['pending', 'in_progress', 'waiting'],
    });
    const { agentMetrics, loading: metricsLoading } = useAgentMetrics();
    
    // Estado para filtro por agente e modo de visualização
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');

    const now = new Date();
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);
    const nextWeek = addDays(today, 7);

    // Helper: get agenda date (remind_at takes priority, fallback to due_at)
    const getAgendaDate = (t: any): Date | null => {
        const dateStr = t.remind_at ?? t.due_at;
        return dateStr ? new Date(dateStr) : null;
    };

    // Filtrar tarefas pelo agente selecionado
    const filteredTasks = selectedAgent 
        ? tasks.filter(t => t.assignee_id === selectedAgent)
        : tasks;

    // Group tasks by date category using agenda date
    const overdueTasks = filteredTasks.filter((t) => {
        const agendaDate = getAgendaDate(t);
        return agendaDate && agendaDate < today;
    });

    const todayTasks = filteredTasks.filter((t) => {
        const agendaDate = getAgendaDate(t);
        return agendaDate && isToday(agendaDate);
    });

    const tomorrowTasks = filteredTasks.filter((t) => {
        const agendaDate = getAgendaDate(t);
        return agendaDate && isTomorrow(agendaDate);
    });

    // Agrupar próximos 7 dias por dia
    const days = eachDayOfInterval({ start: addDays(tomorrow, 1), end: nextWeek });
    const tasksByDay = days.map(day => ({
        date: day,
        tasks: filteredTasks.filter(t => {
            const agendaDate = getAgendaDate(t);
            if (!agendaDate) return false;
            return startOfDay(agendaDate).getTime() === startOfDay(day).getTime();
        })
    })).filter(d => d.tasks.length > 0);

    const noDueTasks = filteredTasks.filter((t) => !getAgendaDate(t));

    const handleStart = async (id: string) => {
        try {
            await startTask(id);
            toast.success('Tarefa iniciada!');
        } catch {
            toast.error('Erro ao iniciar tarefa');
        }
    };

    const handleComplete = async (id: string) => {
        try {
            await completeTask(id);
            toast.success('Tarefa concluída!');
        } catch {
            toast.error('Erro ao concluir tarefa');
        }
    };

    // Card de tarefa compacto para Kanban
    const KanbanTaskCard = ({ task }: { task: any }) => (
        <div className="group bg-card border rounded-lg p-3 shadow-sm hover:shadow-md transition-all cursor-pointer">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">{priorityIcons[task.priority as TaskPriority]}</span>
                        <p className="font-medium text-sm truncate">{task.title}</p>
                    </div>
                    {task.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                        {!selectedAgent && task.assignee?.name && (
                            <Badge variant="outline" className="text-xs py-0">
                                <User className="h-3 w-3 mr-1" />
                                {task.assignee.name.split(' ')[0]}
                            </Badge>
                        )}
                        {(task.remind_at || task.due_at) && (
                            <Badge variant="secondary" className="text-xs py-0">
                                <Clock className="h-3 w-3 mr-1" />
                                {format(new Date(task.remind_at ?? task.due_at), 'HH:mm')}
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {task.status === 'pending' && (
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleStart(task.id)}>
                            <Play className="h-3 w-3" />
                        </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleComplete(task.id)}>
                        <CheckCircle className="h-3 w-3 text-green-600" />
                    </Button>
                </div>
            </div>
        </div>
    );

    // Coluna do Kanban
    const KanbanColumn = ({
        title,
        tasks,
        icon,
        headerColor,
        accentColor,
    }: {
        title: string;
        tasks: any[];
        icon: React.ReactNode;
        headerColor?: string;
        accentColor?: string;
    }) => (
        <div className="flex-shrink-0 w-72 bg-muted/30 rounded-xl overflow-hidden">
            <div className={cn("px-4 py-3 border-b", headerColor || "bg-muted/50")}>
                <div className="flex items-center justify-between">
                    <div className={cn("flex items-center gap-2 font-semibold", accentColor)}>
                        {icon}
                        <span>{title}</span>
                    </div>
                    <Badge variant="secondary" className="font-mono">{tasks.length}</Badge>
                </div>
            </div>
            <ScrollArea className="h-[calc(100vh-320px)]">
                <div className="p-3 space-y-2">
                    {tasks.length === 0 ? (
                        <div className="text-center text-muted-foreground text-sm py-8">
                            Nenhuma tarefa
                        </div>
                    ) : (
                        tasks.map((task) => (
                            <KanbanTaskCard key={task.id} task={task} />
                        ))
                    )}
                </div>
            </ScrollArea>
        </div>
    );

    // Nome do agente selecionado
    const selectedAgentName = selectedAgent 
        ? agentMetrics.find(a => a.assignee_id === selectedAgent)?.assignee_name 
        : null;

    return (
        <AppLayout>
            <div className="p-6 space-y-6 h-full">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        {selectedAgent && (
                            <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => setSelectedAgent(null)}
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        )}
                        <div>
                            <h1 className="text-2xl font-bold flex items-center gap-2">
                                <Calendar className="h-6 w-6" />
                                {selectedAgentName ? `Agenda de ${selectedAgentName}` : 'Agenda'}
                            </h1>
                            <p className="text-muted-foreground">
                                {format(now, "EEEE, d 'de' MMMM", { locale: ptBR })}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Toggle View Mode */}
                        <div className="flex border rounded-lg overflow-hidden">
                            <Button 
                                variant={viewMode === 'kanban' ? 'secondary' : 'ghost'} 
                                size="sm"
                                onClick={() => setViewMode('kanban')}
                                className="rounded-none"
                            >
                                <LayoutGrid className="h-4 w-4" />
                            </Button>
                            <Button 
                                variant={viewMode === 'list' ? 'secondary' : 'ghost'} 
                                size="sm"
                                onClick={() => setViewMode('list')}
                                className="rounded-none"
                            >
                                <List className="h-4 w-4" />
                            </Button>
                        </div>
                        
                        <Link to="/tasks">
                            <Button variant="outline">
                                Ver Todas as Tarefas
                                <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Agent Metrics Cards - Clicáveis */}
                {!metricsLoading && agentMetrics.length > 0 && !selectedAgent && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {agentMetrics.map((agent) => (
                            <Card 
                                key={agent.assignee_id} 
                                className={cn(
                                    "cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] hover:border-primary/50",
                                    "bg-gradient-to-br from-background to-muted/30"
                                )}
                                onClick={() => setSelectedAgent(agent.assignee_id)}
                            >
                                <CardContent className="pt-4 pb-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                            <User className="h-4 w-4 text-primary" />
                                        </div>
                                        <span className="font-medium text-sm truncate">{agent.assignee_name}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs">
                                        <span className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-full bg-yellow-500" />
                                            {agent.pending_count + agent.in_progress_count} pendentes
                                        </span>
                                        <span className="flex items-center gap-1 text-green-600">
                                            <CheckCircle className="h-3 w-3" />
                                            {agent.done_today_count} hoje
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {/* Chip do agente selecionado */}
                {selectedAgent && (
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="py-1.5 px-3 text-sm">
                            <User className="h-4 w-4 mr-2" />
                            {selectedAgentName}
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-4 w-4 ml-2 hover:bg-transparent"
                                onClick={() => setSelectedAgent(null)}
                            >
                                ×
                            </Button>
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                            {filteredTasks.length} tarefas
                        </span>
                    </div>
                )}

                {loading ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            Carregando agenda...
                        </CardContent>
                    </Card>
                ) : filteredTasks.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>Nenhuma tarefa agendada</p>
                            <p className="text-sm">
                                {selectedAgent ? 'Este agente não possui tarefas' : 'Crie tarefas no chat para vê-las aqui'}
                            </p>
                        </CardContent>
                    </Card>
                ) : viewMode === 'kanban' ? (
                    /* KANBAN VIEW */
                    <ScrollArea className="w-full">
                        <div className="flex gap-4 pb-4">
                            {/* Coluna: Atrasadas */}
                            <KanbanColumn
                                title="Atrasadas"
                                tasks={overdueTasks}
                                icon={<AlertTriangle className="h-4 w-4" />}
                                headerColor="bg-red-100 dark:bg-red-950/50"
                                accentColor="text-red-600 dark:text-red-400"
                            />

                            {/* Coluna: Hoje */}
                            <KanbanColumn
                                title="Hoje"
                                tasks={todayTasks}
                                icon={<Calendar className="h-4 w-4" />}
                                headerColor="bg-blue-100 dark:bg-blue-950/50"
                                accentColor="text-blue-600 dark:text-blue-400"
                            />

                            {/* Coluna: Amanhã */}
                            <KanbanColumn
                                title="Amanhã"
                                tasks={tomorrowTasks}
                                icon={<Calendar className="h-4 w-4" />}
                                headerColor="bg-purple-100 dark:bg-purple-950/50"
                                accentColor="text-purple-600 dark:text-purple-400"
                            />

                            {/* Colunas por dia (próximos 7 dias) */}
                            {tasksByDay.map(({ date, tasks }) => (
                                <KanbanColumn
                                    key={date.toISOString()}
                                    title={format(date, "EEE, d", { locale: ptBR })}
                                    tasks={tasks}
                                    icon={<Calendar className="h-4 w-4" />}
                                />
                            ))}

                            {/* Coluna: Sem prazo */}
                            {noDueTasks.length > 0 && (
                                <KanbanColumn
                                    title="Sem prazo"
                                    tasks={noDueTasks}
                                    icon={<Clock className="h-4 w-4 opacity-50" />}
                                    headerColor="bg-gray-100 dark:bg-gray-900"
                                    accentColor="text-gray-500"
                                />
                            )}
                        </div>
                        <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                ) : (
                    /* LIST VIEW (mantém a visualização original) */
                    <div className="space-y-4">
                        {overdueTasks.length > 0 && (
                            <ListSection
                                title="Atrasadas"
                                tasks={overdueTasks}
                                icon={<AlertTriangle className="h-5 w-5" />}
                                bgColor="bg-red-50 dark:bg-red-950"
                                textColor="text-red-600 dark:text-red-400"
                                onStart={handleStart}
                                onComplete={handleComplete}
                            />
                        )}
                        {todayTasks.length > 0 && (
                            <ListSection
                                title="Hoje"
                                tasks={todayTasks}
                                icon={<Calendar className="h-5 w-5" />}
                                bgColor="bg-blue-50 dark:bg-blue-950"
                                textColor="text-blue-600 dark:text-blue-400"
                                onStart={handleStart}
                                onComplete={handleComplete}
                            />
                        )}
                        {tomorrowTasks.length > 0 && (
                            <ListSection
                                title="Amanhã"
                                tasks={tomorrowTasks}
                                icon={<Calendar className="h-5 w-5" />}
                                onStart={handleStart}
                                onComplete={handleComplete}
                            />
                        )}
                        {tasksByDay.map(({ date, tasks }) => (
                            <ListSection
                                key={date.toISOString()}
                                title={format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}
                                tasks={tasks}
                                icon={<Calendar className="h-5 w-5" />}
                                onStart={handleStart}
                                onComplete={handleComplete}
                            />
                        ))}
                        {noDueTasks.length > 0 && (
                            <ListSection
                                title="Sem prazo definido"
                                tasks={noDueTasks}
                                icon={<Clock className="h-5 w-5 opacity-50" />}
                                bgColor="bg-gray-50 dark:bg-gray-900"
                                textColor="text-gray-500"
                                onStart={handleStart}
                                onComplete={handleComplete}
                            />
                        )}
                    </div>
                )}
            </div>
        </AppLayout>
    );
}

// Componente ListSection para modo lista
function ListSection({
    title,
    tasks,
    icon,
    bgColor,
    textColor,
    onStart,
    onComplete,
}: {
    title: string;
    tasks: any[];
    icon: React.ReactNode;
    bgColor?: string;
    textColor?: string;
    onStart: (id: string) => void;
    onComplete: (id: string) => void;
}) {
    return (
        <div className={`rounded-lg ${bgColor || 'bg-muted/50'} p-4`}>
            <div className={`flex items-center gap-2 mb-3 ${textColor || ''}`}>
                {icon}
                <h3 className="font-semibold">{title}</h3>
                <Badge variant="secondary">{tasks.length}</Badge>
            </div>
            <div className="space-y-2">
                {tasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between py-3 px-4 bg-background rounded-lg border">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-lg">{priorityIcons[task.priority as TaskPriority]}</span>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{task.title}</p>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    {task.assignee?.name && (
                                        <span className="flex items-center gap-1">
                                            <User className="h-3 w-3" />
                                            {task.assignee.name}
                                        </span>
                                    )}
                                    {(task.remind_at || task.due_at) && (
                                        <span className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {format(new Date(task.remind_at ?? task.due_at), 'HH:mm')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                            {task.status === 'pending' && (
                                <Button size="sm" variant="ghost" onClick={() => onStart(task.id)}>
                                    <Play className="h-4 w-4" />
                                </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => onComplete(task.id)}>
                                <CheckCircle className="h-4 w-4 text-green-600" />
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
