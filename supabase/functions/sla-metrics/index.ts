import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SLAMetrics {
    totalProtocols: number;
    openProtocols: number;
    resolvedProtocols: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionHours: number | null;
    slaMetPercentage: number;
    byCategory: Record<string, CategoryMetrics>;
    byAgent: AgentMetrics[];
    backlog: BacklogItem[];
}

interface CategoryMetrics {
    total: number;
    resolved: number;
    avgResolutionHours: number | null;
}

interface AgentMetrics {
    agentId: string;
    agentName: string;
    resolved: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionHours: number | null;
}

interface BacklogItem {
    id: string;
    protocolCode: string;
    category: string;
    priority: string;
    ageHours: number;
    slaStatus: string;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const url = new URL(req.url);
        const startDate = url.searchParams.get('start_date') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = url.searchParams.get('end_date') || new Date().toISOString();
        const category = url.searchParams.get('category');

        console.log(`[SLA Metrics] Fetching metrics from ${startDate} to ${endDate}`);

        // Base query
        let query = supabase
            .from('protocols')
            .select('*')
            .gte('created_at', startDate)
            .lte('created_at', endDate);

        if (category) {
            query = query.eq('category', category);
        }

        const { data: protocols, error } = await query;

        if (error) throw error;

        if (!protocols || protocols.length === 0) {
            return new Response(JSON.stringify({
                totalProtocols: 0,
                openProtocols: 0,
                resolvedProtocols: 0,
                avgFirstResponseMinutes: null,
                avgResolutionHours: null,
                slaMetPercentage: 100,
                byCategory: {},
                byAgent: [],
                backlog: [],
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Calculate metrics
        const totalProtocols = protocols.length;
        const openProtocols = protocols.filter(p => p.status === 'open').length;
        const resolvedProtocols = protocols.filter(p => p.status === 'resolved').length;

        // First Response Time (FRT)
        const protocolsWithFRT = protocols.filter(p => p.first_response_at);
        const avgFRT = protocolsWithFRT.length > 0
            ? protocolsWithFRT.reduce((sum, p) => {
                const frtMs = new Date(p.first_response_at).getTime() - new Date(p.created_at).getTime();
                return sum + frtMs / (1000 * 60); // Convert to minutes
            }, 0) / protocolsWithFRT.length
            : null;

        // Resolution Time
        const resolvedWithTime = protocols.filter(p => p.status === 'resolved' && p.resolved_at);
        const avgResolution = resolvedWithTime.length > 0
            ? resolvedWithTime.reduce((sum, p) => {
                const resMs = new Date(p.resolved_at).getTime() - new Date(p.created_at).getTime();
                return sum + resMs / (1000 * 60 * 60); // Convert to hours
            }, 0) / resolvedWithTime.length
            : null;

        // SLA Met %
        const now = new Date();
        const slaMet = protocols.filter(p => {
            if (p.status === 'resolved') return true; // Resolved = met
            const ageHours = (now.getTime() - new Date(p.created_at).getTime()) / (1000 * 60 * 60);
            const limit = p.priority === 'critical' ? 24 : 48;
            return ageHours <= limit;
        }).length;
        const slaMetPercentage = totalProtocols > 0 ? Math.round((slaMet / totalProtocols) * 100) : 100;

        // By Category
        const categories = ['financial', 'support', 'admin', 'operational'];
        const byCategory: Record<string, CategoryMetrics> = {};
        for (const cat of categories) {
            const catProtocols = protocols.filter(p => p.category === cat);
            const catResolved = catProtocols.filter(p => p.status === 'resolved' && p.resolved_at);
            byCategory[cat] = {
                total: catProtocols.length,
                resolved: catProtocols.filter(p => p.status === 'resolved').length,
                avgResolutionHours: catResolved.length > 0
                    ? catResolved.reduce((sum, p) => {
                        const resMs = new Date(p.resolved_at).getTime() - new Date(p.created_at).getTime();
                        return sum + resMs / (1000 * 60 * 60);
                    }, 0) / catResolved.length
                    : null,
            };
        }

        // By Agent (fetch profiles)
        const agentIds = [...new Set(protocols.filter(p => p.resolved_by_agent_id).map(p => p.resolved_by_agent_id))];
        const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name')
            .in('id', agentIds);

        const profileMap = new Map((profiles || []).map(p => [p.id, p.name]));

        const byAgent: AgentMetrics[] = agentIds.map(agentId => {
            const agentProtocols = protocols.filter(p => p.resolved_by_agent_id === agentId);
            const withFRT = agentProtocols.filter(p => p.first_response_at);
            const resolved = agentProtocols.filter(p => p.resolved_at);

            return {
                agentId: agentId as string,
                agentName: profileMap.get(agentId) || 'Desconhecido',
                resolved: resolved.length,
                avgFirstResponseMinutes: withFRT.length > 0
                    ? withFRT.reduce((sum, p) => {
                        return sum + (new Date(p.first_response_at).getTime() - new Date(p.created_at).getTime()) / (1000 * 60);
                    }, 0) / withFRT.length
                    : null,
                avgResolutionHours: resolved.length > 0
                    ? resolved.reduce((sum, p) => {
                        return sum + (new Date(p.resolved_at).getTime() - new Date(p.created_at).getTime()) / (1000 * 60 * 60);
                    }, 0) / resolved.length
                    : null,
            };
        }).sort((a, b) => b.resolved - a.resolved);

        // Backlog (open protocols with SLA at risk or breached)
        const backlog: BacklogItem[] = protocols
            .filter(p => p.status === 'open')
            .map(p => {
                const ageHours = (now.getTime() - new Date(p.created_at).getTime()) / (1000 * 60 * 60);
                const limit = p.priority === 'critical' ? 24 : 48;
                const warnLimit = p.priority === 'critical' ? 12 : 24;

                let slaStatus = 'on_track';
                if (ageHours > limit) slaStatus = 'breached';
                else if (ageHours > warnLimit) slaStatus = 'at_risk';

                return {
                    id: p.id,
                    protocolCode: p.protocol_code,
                    category: p.category || 'operational',
                    priority: p.priority,
                    ageHours: Math.round(ageHours * 10) / 10,
                    slaStatus,
                };
            })
            .filter(p => p.slaStatus !== 'on_track')
            .sort((a, b) => b.ageHours - a.ageHours);

        const metrics: SLAMetrics = {
            totalProtocols,
            openProtocols,
            resolvedProtocols,
            avgFirstResponseMinutes: avgFRT !== null ? Math.round(avgFRT * 10) / 10 : null,
            avgResolutionHours: avgResolution !== null ? Math.round(avgResolution * 10) / 10 : null,
            slaMetPercentage,
            byCategory,
            byAgent,
            backlog,
        };

        console.log(`[SLA Metrics] Processed ${totalProtocols} protocols`);

        return new Response(JSON.stringify(metrics), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('[SLA Metrics Error]', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
