import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type TaskStatus = 'pending' | 'in_progress' | 'waiting' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
    id: string;
    conversation_id: string | null;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    assignee_id: string | null;
    due_at: string | null;
    remind_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    first_action_at: string | null;
    last_action_at: string | null;
    external_ref: string | null;
    // Join fields
    assignee?: { name: string } | null;
    conversation?: { contact_id: string } | null;
}

export interface TaskFilters {
    status?: TaskStatus | TaskStatus[] | 'all';
    assignee_id?: string | 'me' | 'unassigned' | 'all';
    overdue?: boolean;
}

export interface TaskMetrics {
    open_tasks: number;
    overdue_tasks: number;
    followups_due: number;
    done_today: number;
    avg_resolution_seconds_7d: number;
}

export function useTasks(filters?: TaskFilters) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { user } = useAuth();

    const fetchTasks = useCallback(async () => {
        try {
            setLoading(true);
            let query = supabase
                .from('tasks')
                .select('*, assignee:profiles!assignee_id(name)')
                .order('due_at', { ascending: true, nullsFirst: false });

            // Apply status filter
            if (filters?.status && filters.status !== 'all') {
                if (Array.isArray(filters.status)) {
                    query = query.in('status', filters.status);
                } else {
                    query = query.eq('status', filters.status);
                }
            }

            // Apply assignee filter
            if (filters?.assignee_id) {
                if (filters.assignee_id === 'me' && user) {
                    query = query.eq('assignee_id', user.id);
                } else if (filters.assignee_id === 'unassigned') {
                    query = query.is('assignee_id', null);
                } else if (filters.assignee_id !== 'all') {
                    query = query.eq('assignee_id', filters.assignee_id);
                }
            }

            // Apply overdue filter
            if (filters?.overdue) {
                query = query.lt('due_at', new Date().toISOString());
                query = query.not('status', 'in', '("done","cancelled")');
            }

            const { data, error: fetchError } = await query;

            if (fetchError) throw fetchError;
            setTasks((data as Task[]) || []);
            setError(null);
        } catch (err) {
            console.error('Error fetching tasks:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
        } finally {
            setLoading(false);
        }
    }, [filters, user]);

    // Subscribe to realtime updates
    useEffect(() => {
        fetchTasks();

        const channel = supabase
            .channel('tasks-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tasks' },
                (payload) => {
                    console.log('[useTasks] Realtime update:', payload);
                    // Refetch to get joined data
                    fetchTasks();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchTasks]);

    const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
        const { error } = await supabase
            .from('tasks')
            .update(updates)
            .eq('id', id);

        if (error) throw error;
        // Realtime will refetch
    }, []);

    const startTask = useCallback(async (id: string) => {
        await updateTask(id, { status: 'in_progress' });
    }, [updateTask]);

    const completeTask = useCallback(async (id: string) => {
        await updateTask(id, { status: 'done' });
    }, [updateTask]);

    const cancelTask = useCallback(async (id: string) => {
        await updateTask(id, { status: 'cancelled' });
    }, [updateTask]);

    return {
        tasks,
        loading,
        error,
        refetch: fetchTasks,
        updateTask,
        startTask,
        completeTask,
        cancelTask,
    };
}

export function useTaskMetrics() {
    const [metrics, setMetrics] = useState<TaskMetrics | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMetrics = async () => {
            const { data, error } = await supabase
                .from('task_metrics_dashboard')
                .select('*')
                .single();

            if (!error && data) {
                setMetrics(data as TaskMetrics);
            }
            setLoading(false);
        };

        fetchMetrics();

        // Subscribe to task changes to update metrics
        const channel = supabase
            .channel('task-metrics-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tasks' },
                () => fetchMetrics()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return { metrics, loading };
}

// Helper to format seconds to readable time
export function formatSecondsToHM(seconds: number): string {
    const s = Math.round(seconds || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
