import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTasks, TaskPriority, formatSecondsToHM } from '@/hooks/useTasks';
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

    const now = new Date();
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);
    const nextWeek = addDays(today, 7);

    // Group tasks by date category
    const overdueTasks = tasks.filter(
        (t) => t.due_at && new Date(t.due_at) < today
    );

    const todayTasks = tasks.filter(
        (t) => t.due_at && isToday(new Date(t.due_at))
    );

    const tomorrowTasks = tasks.filter(
        (t) => t.due_at && isTomorrow(new Date(t.due_at))
    );

    const next7DaysTasks = tasks.filter((t) => {
        if (!t.due_at) return false;
        const dueDate = new Date(t.due_at);
        return dueDate > endOfDay(tomorrow) && dueDate <= endOfDay(nextWeek);
    });

    const noDueTasks = tasks.filter((t) => !t.due_at);

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
                        {task.due_at && (
                            <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {format(new Date(task.due_at), 'HH:mm')}
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
