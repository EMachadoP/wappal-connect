import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTasks, TaskStatus, TaskPriority, formatSecondsToHM, useTaskMetrics } from '@/hooks/useTasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
    Play,
    CheckCircle,
    Clock,
    AlertTriangle,
    Calendar,
    User,
    Filter,
    RefreshCw,
    ListTodo,
    XCircle,
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

const statusLabels: Record<TaskStatus, string> = {
    pending: 'Pendente',
    in_progress: 'Em Andamento',
    waiting: 'Aguardando',
    done: 'Concluída',
    cancelled: 'Cancelada',
};

const statusColors: Record<TaskStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    waiting: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    done: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
};

const priorityIcons: Record<TaskPriority, string> = {
    low: '🟢',
    normal: '🔵',
    high: '🟠',
    urgent: '🔴',
};

export default function Tasks() {
    type TabType = 'pendentes' | 'resolvidas' | 'canceladas';
    const [activeTab, setActiveTab] = useState<TabType>('pendentes');
    const [showOverdueOnly, setShowOverdueOnly] = useState(false);
    const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'me'>('all');

    // Map tabs to status filters
    const getStatusFilter = (tab: TabType): TaskStatus | TaskStatus[] => {
        switch (tab) {
            case 'pendentes': return ['pending', 'in_progress', 'waiting'];
            case 'resolvidas': return 'done';
            case 'canceladas': return 'cancelled';
        }
    };

    const { tasks, loading, error, refetch, startTask, completeTask, cancelTask } = useTasks({
        status: getStatusFilter(activeTab),
        overdue: activeTab === 'pendentes' ? showOverdueOnly : false,
        assignee_id: assigneeFilter,
    });

    const { metrics } = useTaskMetrics();

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

    const handleCancel = async (id: string) => {
        try {
            await cancelTask(id);
            toast.success('Tarefa cancelada');
        } catch {
            toast.error('Erro ao cancelar tarefa');
        }
    };

    const formatDueDate = (dueAt: string | null) => {
        if (!dueAt) return null;
        const date = new Date(dueAt);
        const overdue = isPast(date) && !isToday(date);

        let text = '';
        if (isToday(date)) {
            text = `Hoje às ${format(date, 'HH:mm')}`;
        } else if (isTomorrow(date)) {
            text = `Amanhã às ${format(date, 'HH:mm')}`;
        } else if (overdue) {
            text = `Atrasada: ${formatDistanceToNow(date, { locale: ptBR, addSuffix: true })}`;
        } else {
            text = format(date, "dd/MM 'às' HH:mm", { locale: ptBR });
        }

        return { text, overdue };
    };

    return (
        <AppLayout>
            <div className="p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <ListTodo className="h-6 w-6" />
                            Tarefas
                        </h1>
                        <p className="text-muted-foreground">Gerencie suas tarefas e pendências</p>
                    </div>

                    <Button variant="outline" onClick={() => refetch()} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Atualizar
                    </Button>
                </div>

                {/* Metrics Cards */}
                {metrics && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <Card>
                            <CardContent className="pt-4">
                                <div className="text-2xl font-bold">{metrics.open_tasks}</div>
                                <div className="text-sm text-muted-foreground">Abertas</div>
                            </CardContent>
                        </Card>
                        <Card className={metrics.overdue_tasks > 0 ? 'border-red-500' : ''}>
                            <CardContent className="pt-4">
                                <div className={`text-2xl font-bold ${metrics.overdue_tasks > 0 ? 'text-red-500' : ''}`}>
                                    {metrics.overdue_tasks}
                                </div>
                                <div className="text-sm text-muted-foreground">Atrasadas</div>
                            </CardContent>
                        </Card>
                        <Card className={metrics.followups_due > 0 ? 'border-orange-500' : ''}>
                            <CardContent className="pt-4">
                                <div className={`text-2xl font-bold ${metrics.followups_due > 0 ? 'text-orange-500' : ''}`}>
                                    {metrics.followups_due}
                                </div>
                                <div className="text-sm text-muted-foreground">Follow-ups</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-4">
                                <div className="text-2xl font-bold text-green-600">{metrics.done_today}</div>
                                <div className="text-sm text-muted-foreground">Concluídas Hoje</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-4">
                                <div className="text-2xl font-bold">{formatSecondsToHM(metrics.avg_resolution_seconds_7d)}</div>
                                <div className="text-sm text-muted-foreground">Tempo Médio (7d)</div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                    <Button
                        variant={activeTab === 'pendentes' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setActiveTab('pendentes')}
                        className="px-4"
                    >
                        Pendentes
                        {metrics && <Badge variant="secondary" className="ml-2">{metrics.open_tasks}</Badge>}
                    </Button>
                    <Button
                        variant={activeTab === 'resolvidas' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setActiveTab('resolvidas')}
                        className="px-4"
                    >
                        Resolvidas
                        {metrics && <Badge variant="secondary" className="ml-2">{metrics.done_today}</Badge>}
                    </Button>
                    <Button
                        variant={activeTab === 'canceladas' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setActiveTab('canceladas')}
                        className="px-4"
                    >
                        Canceladas
                    </Button>
                </div>

                {/* Filters */}
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Filter className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Filtros:</span>
                            </div>

                            <Select value={assigneeFilter} onValueChange={(v: any) => setAssigneeFilter(v)}>
                                <SelectTrigger className="w-[140px]">
                                    <SelectValue placeholder="Responsável" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos</SelectItem>
                                    <SelectItem value="me">Minhas</SelectItem>
                                </SelectContent>
                            </Select>

                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="overdue"
                                    checked={showOverdueOnly}
                                    onCheckedChange={(c) => setShowOverdueOnly(!!c)}
                                />
                                <Label htmlFor="overdue" className="text-sm cursor-pointer">
                                    Apenas atrasadas
                                </Label>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Task List */}
                <div className="space-y-3">
                    {error && (
                        <Card className="border-red-500">
                            <CardContent className="pt-4 text-red-500">{error}</CardContent>
                        </Card>
                    )}

                    {loading && tasks.length === 0 ? (
                        <Card>
                            <CardContent className="pt-4 text-center text-muted-foreground">
                                Carregando tarefas...
                            </CardContent>
                        </Card>
                    ) : tasks.length === 0 ? (
                        <Card>
                            <CardContent className="pt-4 text-center text-muted-foreground">
                                Nenhuma tarefa encontrada com os filtros selecionados
                            </CardContent>
                        </Card>
                    ) : (
                        tasks.map((task) => {
                            const due = formatDueDate(task.due_at);

                            return (
                                <Card
                                    key={task.id}
                                    className={`${due?.overdue ? 'border-red-500 bg-red-50 dark:bg-red-950' : ''}`}
                                >
                                    <CardContent className="py-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-lg">{priorityIcons[task.priority]}</span>
                                                    <h3 className="font-medium truncate">{task.title}</h3>
                                                    <Badge className={statusColors[task.status]}>
                                                        {statusLabels[task.status]}
                                                    </Badge>
                                                </div>

                                                {task.description && (
                                                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                                                        {task.description}
                                                    </p>
                                                )}

                                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                                    {task.assignee?.name && (
                                                        <span className="flex items-center gap-1">
                                                            <User className="h-3 w-3" />
                                                            {task.assignee.name}
                                                        </span>
                                                    )}

                                                    {due && (
                                                        <span className={`flex items-center gap-1 ${due.overdue ? 'text-red-500 font-medium' : ''}`}>
                                                            {due.overdue ? (
                                                                <AlertTriangle className="h-3 w-3" />
                                                            ) : (
                                                                <Calendar className="h-3 w-3" />
                                                            )}
                                                            {due.text}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-2">
                                                {task.status === 'pending' && (
                                                    <Button size="sm" variant="outline" onClick={() => handleStart(task.id)}>
                                                        <Play className="h-4 w-4 mr-1" />
                                                        Iniciar
                                                    </Button>
                                                )}

                                                {(task.status === 'pending' || task.status === 'in_progress' || task.status === 'waiting') && (
                                                    <Button size="sm" variant="default" onClick={() => handleComplete(task.id)}>
                                                        <CheckCircle className="h-4 w-4 mr-1" />
                                                        Concluir
                                                    </Button>
                                                )}

                                                {task.status !== 'done' && task.status !== 'cancelled' && (
                                                    <Button size="sm" variant="ghost" onClick={() => handleCancel(task.id)}>
                                                        <XCircle className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
