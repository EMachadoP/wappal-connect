import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTasks, TaskPriority, formatSecondsToHM, useAgentMetrics } from '@/hooks/useTasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Calendar,
    Clock,
    AlertTriangle,
    CheckCircle,
    Play,
    User,
    ChevronRight,
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, addDays, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

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

    const now = new Date();
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);
    const nextWeek = addDays(today, 7);

    // Helper: get agenda date (remind_at takes priority, fallback to due_at)
    const getAgendaDate = (t: any): Date | null => {
        const dateStr = t.remind_at ?? t.due_at;
        return dateStr ? new Date(dateStr) : null;
    };

    // Group tasks by date category using agenda date
    const overdueTasks = tasks.filter((t) => {
        const agendaDate = getAgendaDate(t);
        return agendaDate && agendaDate < today;
    });

    const todayTasks = tasks.filter((t) => {
        const agendaDate = getAgendaDate(t);
        return agendaDate && isToday(agendaDate);
    });

    const tomorrowTasks = tasks.filter((t) => {
        const agendaDate = getAgendaDate(t);
        return agendaDate && isTomorrow(agendaDate);
    });

    const next7DaysTasks = tasks.filter((t) => {
        const agendaDate = getAgendaDate(t);
        if (!agendaDate) return false;
        return agendaDate > endOfDay(tomorrow) && agendaDate <= endOfDay(nextWeek);
    });

    const noDueTasks = tasks.filter((t) => !getAgendaDate(t));

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

    const TaskCard = ({ task }: { task: any }) => (
        <div className="flex items-center justify-between py-3 px-4 bg-background rounded-lg border">
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
                                {task.remind_at && <span className="text-xs opacity-60">(lembrete)</span>}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 ml-4">
                {task.status === 'pending' && (
                    <Button size="sm" variant="ghost" onClick={() => handleStart(task.id)}>
                        <Play className="h-4 w-4" />
                    </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => handleComplete(task.id)}>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                </Button>
            </div>
        </div>
    );

    const AgendaSection = ({
        title,
        tasks,
        icon,
        bgColor,
        textColor,
    }: {
        title: string;
        tasks: any[];
        icon: React.ReactNode;
        bgColor?: string;
        textColor?: string;
    }) => {
        if (tasks.length === 0) return null;

        return (
            <div className={`rounded-lg ${bgColor || 'bg-muted/50'} p-4`}>
                <div className={`flex items-center gap-2 mb-3 ${textColor || ''}`}>
                    {icon}
                    <h3 className="font-semibold">{title}</h3>
                    <Badge variant="secondary">{tasks.length}</Badge>
                </div>
                <div className="space-y-2">
                    {tasks.map((task) => (
                        <TaskCard key={task.id} task={task} />
                    ))}
                </div>
            </div>
        );
    };

    return (
        <AppLayout>
            <div className="p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Calendar className="h-6 w-6" />
                            Agenda
                        </h1>
                        <p className="text-muted-foreground">
                            {format(now, "EEEE, d 'de' MMMM", { locale: ptBR })}
                        </p>
                    </div>

                    <Link to="/tasks">
                        <Button variant="outline">
                            Ver Todas as Tarefas
                            <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                    </Link>
                </div>

                {/* Agent Metrics Cards */}
                {!metricsLoading && agentMetrics.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {agentMetrics.map((agent) => (
                            <Card key={agent.assignee_id} className="bg-gradient-to-br from-background to-muted/30">
                                <CardContent className="pt-4 pb-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <User className="h-4 w-4 text-muted-foreground" />
                                        <span className="font-medium text-sm truncate">{agent.assignee_name}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs">
                                        <span className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-full bg-yellow-500" />
                                            {agent.pending_count + agent.in_progress_count} pendente{agent.pending_count + agent.in_progress_count !== 1 ? 's' : ''}
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

                {loading ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            Carregando agenda...
                        </CardContent>
                    </Card>
                ) : tasks.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>Nenhuma tarefa agendada</p>
                            <p className="text-sm">Crie tarefas no chat para vê-las aqui</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {/* Overdue - Red section */}
                        <AgendaSection
                            title="Atrasadas"
                            tasks={overdueTasks}
                            icon={<AlertTriangle className="h-5 w-5" />}
                            bgColor="bg-red-50 dark:bg-red-950"
                            textColor="text-red-600 dark:text-red-400"
                        />

                        {/* Today */}
                        <AgendaSection
                            title="Hoje"
                            tasks={todayTasks}
                            icon={<Calendar className="h-5 w-5" />}
                            bgColor="bg-blue-50 dark:bg-blue-950"
                            textColor="text-blue-600 dark:text-blue-400"
                        />

                        {/* Tomorrow */}
                        <AgendaSection
                            title="Amanhã"
                            tasks={tomorrowTasks}
                            icon={<Calendar className="h-5 w-5" />}
                        />

                        {/* Next 7 days */}
                        <AgendaSection
                            title="Próximos 7 dias"
                            tasks={next7DaysTasks}
                            icon={<Clock className="h-5 w-5" />}
                        />

                        {/* No due date */}
                        <AgendaSection
                            title="Sem prazo definido"
                            tasks={noDueTasks}
                            icon={<Clock className="h-5 w-5 opacity-50" />}
                            bgColor="bg-gray-50 dark:bg-gray-900"
                            textColor="text-gray-500"
                        />
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
