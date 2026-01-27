import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.92.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Working hours (in minutes from midnight)
const MORNING_START = 8 * 60;  // 08:00
const MORNING_END = 12 * 60;   // 12:00
const AFTERNOON_START = 13 * 60; // 13:00
const AFTERNOON_END = 17 * 60;   // 17:00
const DAILY_CAP = 480; // Max 8 hours per day per technician

// Priority order (higher = more urgent)
const PRIORITY_ORDER: Record<string, number> = {
    urgent: 4,
    high: 3,
    normal: 2,
    low: 1,
};

interface SlotAllocation {
    technician_id: string;
    start_minute: number;
    end_minute: number;
}

function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

serve(async (req) => {
    const reqId = crypto.randomUUID();
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        console.log(`--- [rebuild-plan] START v5.1 reqId=${reqId} ---`);

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!supabaseUrl || !serviceRoleKey) {
            console.error('[rebuild-plan] Missing env vars');
            throw new Error("Missing database configuration (SUPABASE_URL/SERVICE_ROLE_KEY)");
        }

        const admin = createClient(supabaseUrl, serviceRoleKey);

        // 1. Authenticate calling user
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json(401, { error: 'Missing Auth' });

        const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
        if (authErr || !user) return json(401, { error: 'Invalid JWT' });

        // 2. Parse request
        const body = await req.json().catch(() => ({}));
        const { start_date, days = 7 } = body;

        if (!start_date) {
            console.warn(`[rebuild-plan] reqId=${reqId} No start_date in body:`, body);
            return json(400, { error: "start_date required", reqId });
        }

        const start = new Date(start_date);
        if (isNaN(start.getTime())) {
            return json(400, { error: "Invalid start_date format", reqId });
        }

        const dates: string[] = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            dates.push(d.toISOString().split('T')[0]);
        }

        const isWeekday = (dateStr: string) => {
            const d = new Date(dateStr + "T00:00:00");
            const day = d.getDay(); // 0 dom, 6 sáb
            return day >= 1 && day <= 5;
        };
        const weekdayDates = dates.filter(isWeekday);
        const endDate = dates[dates.length - 1];

        // 3. Lock
        const lockKey = `plan:${start_date}:${days}`;
        const { error: lockErr } = await admin.from('planner_locks').insert({ lock_key: lockKey });
        if (lockErr) return json(409, { error: "Already running (lock exists)", reqId });

        try {
            // 4. Clean up
            const { data: plannedInRange, error: pirErr } = await admin
                .from('plan_items')
                .select('work_item_id')
                .gte('plan_date', start_date)
                .lte('plan_date', endDate);

            if (pirErr) throw new Error(`Error loading planned ids: ${pirErr.message}`);

            const workItemIdsInRange = Array.from(
                new Set((plannedInRange || []).map((x: any) => x.work_item_id).filter(Boolean))
            );

            await admin.from('plan_items')
                .delete()
                .gte('plan_date', start_date)
                .lte('plan_date', endDate)
                .or('source.eq.auto,source.is.null'); // Só deleta auto, preserva manual

            // Reseta SOMENTE os work items que estavam agendados nesse range
            if (workItemIdsInRange.length > 0) {
                await admin.from('protocol_work_items')
                    .update({ assignment_group_id: null, status: 'open' })
                    .in('id', workItemIdsInRange);
            }

            // 5. Load Work Items - PATCH 3.1: Filtrar por categorias agendáveis
            const SCHEDULABLE_CATEGORIES = ['operational', 'support'];

            const { data: rawItems, error: wiErr } = await admin
                .from('protocol_work_items')
                .select('*')
                .in('status', ['open', 'planned']);

            if (wiErr) throw new Error(`Error loading work items: ${wiErr.message}`);

            const workItems = (rawItems || []).filter((wi: any) => {
                const cat = (wi.category || '').toLowerCase();
                return SCHEDULABLE_CATEGORIES.includes(cat);
            });

            console.log(`[rebuild-plan] Filtered: ${workItems.length} schedulable from ${rawItems?.length} total`);

            if (!workItems || workItems.length === 0) {
                return json(200, { scheduled: 0, reqId, filtered: rawItems?.length || 0 });
            }

            // Sort: Critical -> Priority -> CreatedAt
            workItems.sort((a, b) => {
                const aCrit = (a.criticality === 'critical' || a.sla_business_days === 0) ? 0 : 1;
                const bCrit = (b.criticality === 'critical' || b.sla_business_days === 0) ? 0 : 1;
                if (aCrit !== bCrit) return aCrit - bCrit;

                const pa = PRIORITY_ORDER[a.priority] || 2;
                const pb = PRIORITY_ORDER[b.priority] || 2;
                if (pa !== pb) return pb - pa;

                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });

            // 6. Load Techs
            const { data: technicians, error: techErr } = await admin
                .from('technicians')
                .select('id, name, dispatch_priority, is_wildcard, technician_skills(skills(code))')
                .eq('is_active', true);

            // If is_wildcard is missing, retry without it to avoid 500
            let finalTechs = technicians;
            if (techErr && techErr.message.includes('is_wildcard')) {
                console.warn(`[rebuild-plan] reqId=${reqId} Column is_wildcard missing, falling back.`);
                const { data: techDataRetry, error: techErrRetry } = await admin
                    .from('technicians')
                    .select('id, name, dispatch_priority, technician_skills(skills(code))')
                    .eq('is_active', true);
                if (techErrRetry) throw new Error(`Error loading technicians (retry): ${techErrRetry.message}`);
                finalTechs = techDataRetry;
            } else if (techErr) {
                throw new Error(`Error loading technicians: ${techErr.message}`);
            }

            const techWithSkills = (finalTechs || []).map((t: any) => ({
                id: t.id,
                name: t.name,
                is_wildcard: t.is_wildcard || false,
                dispatch_priority: t.dispatch_priority || 100,
                skills: (t.technician_skills || []).map((ts: any) => ts.skills?.code).filter(Boolean),
            }));

            // 7. Allocation Loop
            const planItems: any[] = [];
            const scheduledIds: string[] = [];
            const allocations = new Map<string, SlotAllocation[]>();
            const loadByTechDay = new Map<string, number>();

            const getLoad = (techId: string, dateStr: string) => loadByTechDay.get(`${techId}:${dateStr}`) || 0;

            for (const wi of workItems) {
                const duration = wi.estimated_minutes || 60;
                const isCritical = wi.criticality === 'critical' || wi.sla_business_days === 0;

                // Heuristic: non-critical items prefer D+1 and D+2 before D0
                const preferredDates = isCritical
                    ? weekdayDates
                    : [...weekdayDates.slice(1, 3), weekdayDates[0], ...weekdayDates.slice(3)];

                let allocated = false;
                for (const dateStr of preferredDates) {
                    const reqPeople = wi.required_people || 1;
                    const reqSkills = wi.required_skill_codes || [];

                    // Filter and Score techs for this day
                    const compatibleTechs = techWithSkills
                        .filter(t => reqSkills.length === 0 || reqSkills.every(s => t.skills.includes(s)))
                        .filter(t => getLoad(t.id, dateStr) + duration <= DAILY_CAP)
                        .map(t => {
                            const wildcardPenalty = (t.is_wildcard || t.dispatch_priority >= 300) ? 100000 : 0;
                            const priorityPenalty = (t.dispatch_priority || 100);
                            const currentLoad = getLoad(t.id, dateStr);
                            return { ...t, score: wildcardPenalty + priorityPenalty + currentLoad };
                        })
                        .sort((a, b) => a.score - b.score);

                    if (compatibleTechs.length < reqPeople) continue;

                    // Match Slot
                    let commonSlot = null;
                    for (let startMin = MORNING_START; startMin <= AFTERNOON_END - duration; startMin += 15) {
                        if (startMin < MORNING_END && startMin + duration > MORNING_END) continue;
                        if (startMin >= MORNING_END && startMin < AFTERNOON_START) continue;

                        const availableForThisSlot = [];
                        const endMin = startMin + duration;

                        for (const tech of compatibleTechs) {
                            const dayAllocs = allocations.get(`${tech.id}:${dateStr}`) || [];
                            const isFree = !dayAllocs.some(a =>
                                (startMin >= a.start_minute && startMin < a.end_minute) ||
                                (endMin > a.start_minute && endMin <= a.end_minute) ||
                                (startMin <= a.start_minute && endMin >= a.end_minute)
                            );
                            if (isFree) availableForThisSlot.push(tech);
                            if (availableForThisSlot.length === reqPeople) {
                                commonSlot = { startMin, endMin, techs: [...availableForThisSlot] };
                                break;
                            }
                        }
                        if (commonSlot) break;
                    }

                    if (commonSlot) {
                        const groupId = crypto.randomUUID();
                        for (const tech of commonSlot.techs) {
                            const key = `${tech.id}:${dateStr}`;
                            const dayAllocs = allocations.get(key) || [];
                            planItems.push({
                                plan_date: dateStr,
                                technician_id: tech.id,
                                work_item_id: wi.id,
                                start_minute: commonSlot.startMin,
                                end_minute: commonSlot.endMin,
                                sequence: dayAllocs.length,
                                assignment_group_id: groupId
                            });
                            dayAllocs.push({
                                technician_id: tech.id,
                                start_minute: commonSlot.startMin,
                                end_minute: commonSlot.endMin
                            });
                            allocations.set(key, dayAllocs);
                            loadByTechDay.set(key, getLoad(tech.id, dateStr) + duration);
                        }
                        scheduledIds.push(wi.id);
                        await admin.from('protocol_work_items').update({ assignment_group_id: groupId }).eq('id', wi.id);
                        allocated = true;
                        break;
                    }
                }
            }

            // 8. Bulk Save
            if (planItems.length > 0) {
                await admin.from('plan_items').insert(planItems);
                await admin.from('protocol_work_items').update({ status: 'planned' }).in('id', scheduledIds);
            }

            return json(200, { ok: true, scheduled: scheduledIds.length, reqId });

        } finally {
            await admin.from('planner_locks').delete().eq('lock_key', lockKey);
        }
    } catch (e) {
        console.error(`[rebuild-plan] ERROR reqId=${reqId}:`, e);
        return json(500, {
            ok: false,
            message: (e as Error).message,
            reqId
        });
    }
});
