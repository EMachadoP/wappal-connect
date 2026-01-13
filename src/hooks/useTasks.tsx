import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

    // Track if component is mounted to prevent state updates after unmount
    const mountedRef = useRef(true);

    // Stabilize filters to prevent unnecessary refetches
    const stableFilters = useMemo(() => ({
        status: filters?.status,
        assignee_id: filters?.assignee_id,
        overdue: filters?.overdue,
    }), [
        // Convert array to string for stable comparison
        Array.isArray(filters?.status) ? filters.status.join(',') : filters?.status,
        filters?.assignee_id,
        filters?.overdue
    ]);

    // Fetch tasks - NO RETRIES to prevent loops
    const fetchTasks = useCallback(async () => {
        if (!mountedRef.current) return;

        try {
            setLoading(true);
            setError(null);

            let query = supabase
                .from('tasks')
                .select('*, assignee:profiles!assignee_id(name)')
                .order('due_at', { ascending: true, nullsFirst: false });

            // Apply status filter
            if (stableFilters.status && stableFilters.status !== 'all') {
                if (Array.isArray(stableFilters.status)) {
                    query = query.in('status', stableFilters.status);
                } else {
                    query = query.eq('status', stableFilters.status);
                }
            }

            // Apply assignee filter
            if (stableFilters.assignee_id) {
                if (stableFilters.assignee_id === 'me' && user) {
                    query = query.eq('assignee_id', user.id);
                } else if (stableFilters.assignee_id === 'unassigned') {
                    query = query.is('assignee_id', null);
                } else if (stableFilters.assignee_id !== 'all') {
                    query = query.eq('assignee_id', stableFilters.assignee_id);
                }
            }

            // Apply overdue filter
            if (stableFilters.overdue) {
                query = query.lt('due_at', new Date().toISOString());
                query = query.not('status', 'in', '("done","cancelled")');
            }

            const { data, error: fetchError } = await query;

            // Check if still mounted before updating state
            if (!mountedRef.current) return;

            if (fetchError) {
                console.error('[useTasks] Fetch error:', fetchError.message);
                setError(fetchError.message);
            } else {
                setTasks((data as Task[]) || []);
            }
        } catch (err) {
            if (!mountedRef.current) return;
            console.error('[useTasks] Exception:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [stableFilters.status, stableFilters.assignee_id, stableFilters.overdue, user?.id]);

    // Initial fetch + realtime subscription
    useEffect(() => {
        mountedRef.current = true;

        // Initial fetch
        fetchTasks();

        // Debounce realtime refetches to prevent rapid-fire requests
        let debounceTimer: NodeJS.Timeout | null = null;

        const channel = supabase
            .channel(`tasks-realtime-${Date.now()}`) // Unique channel name
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tasks' },
                () => {
                    // Debounce: wait 500ms before refetching
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        if (mountedRef.current) {
                            console.log('[useTasks] Realtime update, refetching...');
                            fetchTasks();
                        }
                    }, 500);
                }
            )
            .subscribe();

        return () => {
            mountedRef.current = false;
            if (debounceTimer) clearTimeout(debounceTimer);
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
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;

        const fetchMetrics = async () => {
            try {
                const { data, error } = await supabase
                    .from('task_metrics_dashboard')
                    .select('*')
                    .single();

                if (!mountedRef.current) return;

                if (!error && data) {
                    setMetrics(data as TaskMetrics);
                }
            } catch (err) {
                console.error('[useTaskMetrics] Error:', err);
            } finally {
                if (mountedRef.current) {
                    setLoading(false);
                }
            }
        };

        fetchMetrics();

        // Debounce realtime updates
        let debounceTimer: NodeJS.Timeout | null = null;

        const channel = supabase
            .channel(`task-metrics-realtime-${Date.now()}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tasks' },
                () => {
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        if (mountedRef.current) fetchMetrics();
                    }, 500);
                }
            )
            .subscribe();

        return () => {
            mountedRef.current = false;
            if (debounceTimer) clearTimeout(debounceTimer);
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

// Per-agent metrics
export interface AgentMetrics {
    assignee_id: string | null;
    assignee_name: string | null;
    pending_count: number;
    in_progress_count: number;
    done_today_count: number;
}

export function useAgentMetrics() {
    const [agentMetrics, setAgentMetrics] = useState<AgentMetrics[]>([]);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;

        const fetchAgentMetrics = async () => {
            try {
                // Get today's start/end in UTC
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const todayStart = today.toISOString();
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowStart = tomorrow.toISOString();

                // Fetch all tasks with assignee info
                const { data, error } = await supabase
                    .from('tasks')
                    .select('assignee_id, status, completed_at, assignee:profiles!assignee_id(name)')
                    .not('assignee_id', 'is', null);

                if (error) throw error;
                if (!mountedRef.current) return;

                // Group by assignee
                const metricsMap = new Map<string, AgentMetrics>();

                data?.forEach((task: any) => {
                    const id = task.assignee_id;
                    if (!id) return;

                    if (!metricsMap.has(id)) {
                        metricsMap.set(id, {
                            assignee_id: id,
                            assignee_name: task.assignee?.name || 'Desconhecido',
                            pending_count: 0,
                            in_progress_count: 0,
                            done_today_count: 0,
                        });
                    }

                    const m = metricsMap.get(id)!;

                    if (task.status === 'pending' || task.status === 'waiting') {
                        m.pending_count++;
                    } else if (task.status === 'in_progress') {
                        m.in_progress_count++;
                    } else if (task.status === 'done' && task.completed_at) {
                        const completedDate = new Date(task.completed_at);
                        if (completedDate >= new Date(todayStart) && completedDate < new Date(tomorrowStart)) {
                            m.done_today_count++;
                        }
                    }
                });

                setAgentMetrics(Array.from(metricsMap.values()).sort((a, b) =>
                    (a.assignee_name || '').localeCompare(b.assignee_name || '')
                ));
            } catch (err) {
                console.error('[useAgentMetrics] Error:', err);
            } finally {
                if (mountedRef.current) {
                    setLoading(false);
                }
            }
        };

        fetchAgentMetrics();

        // Debounce realtime updates
        let debounceTimer: NodeJS.Timeout | null = null;

        const channel = supabase
            .channel(`agent-metrics-realtime-${Date.now()}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tasks' },
                () => {
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        if (mountedRef.current) fetchAgentMetrics();
                    }, 500);
                }
            )
            .subscribe();

        return () => {
            mountedRef.current = false;
            if (debounceTimer) clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, []);

    return { agentMetrics, loading };
}
