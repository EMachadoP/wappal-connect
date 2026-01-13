import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Working hours (in minutes from midnight)
const MORNING_START = 8 * 60;  // 08:00
const MORNING_END = 12 * 60;   // 12:00
const AFTERNOON_START = 13 * 60; // 13:00
const AFTERNOON_END = 17 * 60;   // 17:00

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
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        console.log('--- [rebuild-plan] START ---');

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!supabaseUrl || !serviceRoleKey) {
            console.error('[rebuild-plan] Missing env vars');
            return json(500, { error: "Missing config" });
        }

        const admin = createClient(supabaseUrl, serviceRoleKey);

        // 1. Authenticate calling user
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json(401, { error: 'Missing Auth' });

        const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
        if (authErr || !user) return json(401, { error: 'Invalid JWT' });

        // 2. Parse request
        const { start_date, days = 7 } = await req.json().catch(() => ({}));
        if (!start_date) return json(400, { error: "start_date required" });

        const start = new Date(start_date);
        const end = new Date(start);
        end.setDate(end.getDate() + days - 1);
        const endDate = end.toISOString().split('T')[0];

        // 3. Lock
        const lockKey = `plan:${start_date}:${days}`;
        const { error: lockErr } = await admin.from('planner_locks').insert({ lock_key: lockKey });
        if (lockErr) return json(409, { error: "Already running" });

        try {
            // 4. Clean up
            await admin.from('plan_items').delete().gte('plan_date', start_date).lte('plan_date', endDate);

            // 5. Load Work Items
            const { data: workItems, error: wiErr } = await admin
                .from('protocol_work_items')
                .select('*')
                .eq('status', 'open');

            if (wiErr) throw wiErr;
            if (!workItems || workItems.length === 0) return json(200, { scheduled: 0 });

            // Sort: Critical -> Date -> Priority
            workItems.sort((a, b) => {
                const critA = a.criticality === 'critical' ? 1 : 0;
                const critB = b.criticality === 'critical' ? 1 : 0;
                if (critB !== critA) return critB - critA;
                const dueA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
                const dueB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
                if (dueA !== dueB) return dueA - dueB;
                const pa = PRIORITY_ORDER[a.priority] || 2;
                const pb = PRIORITY_ORDER[b.priority] || 2;
                return pb - pa;
            });

            // 6. Load Techs
            const { data: technicians, error: techErr } = await admin
                .from('technicians')
                .select('id, name, dispatch_priority, technician_skills(skills(code))')
                .eq('is_active', true);

            if (techErr) throw techErr;

            const techWithSkills = technicians.map((t: any) => ({
                id: t.id,
                name: t.name,
                dispatch_priority: t.dispatch_priority || 100,
                skills: (t.technician_skills || []).map((ts: any) => ts.skills?.code).filter(Boolean),
            }));

            // 7. Allocation Loop
            const planItems: any[] = [];
            const scheduledIds: string[] = [];
            const allocations = new Map<string, SlotAllocation[]>();

            for (let d = 0; d < days; d++) {
                const currentDate = new Date(start);
                currentDate.setDate(currentDate.getDate() + d);
                const dateStr = currentDate.toISOString().split('T')[0];

                for (const wi of workItems) {
                    if (scheduledIds.includes(wi.id)) continue;

                    const reqPeople = wi.required_people || 1;
                    const reqSkills = wi.required_skill_codes || [];

                    // Filter and Sort compatible techs for this day
                    const compatibleTechs = techWithSkills
                        .filter(t => reqSkills.length === 0 || reqSkills.every(s => t.skills.includes(s)))
                        .sort((a, b) => {
                            if (a.dispatch_priority !== b.dispatch_priority) return a.dispatch_priority - b.dispatch_priority;
                            const loadA = (allocations.get(`${a.id}:${dateStr}`) || []).reduce((sum, s) => sum + (s.end_minute - s.start_minute), 0);
                            const loadB = (allocations.get(`${b.id}:${dateStr}`) || []).reduce((sum, s) => sum + (s.end_minute - s.start_minute), 0);
                            return loadA - loadB;
                        });

                    if (compatibleTechs.length < reqPeople) continue;

                    // Match Slot
                    let commonSlot = null;
                    const duration = wi.estimated_minutes;
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
                        }
                        scheduledIds.push(wi.id);
                        await admin.from('protocol_work_items').update({ assignment_group_id: groupId }).eq('id', wi.id);
                    }
                }
            }

            // 8. Bulk Save
            if (planItems.length > 0) {
                await admin.from('plan_items').insert(planItems);
                await admin.from('protocol_work_items').update({ status: 'planned' }).in('id', scheduledIds);
            }

            return json(200, { ok: true, scheduled: scheduledIds.length });

        } finally {
            await admin.from('planner_locks').delete().eq('lock_key', lockKey);
        }
    } catch (e) {
        return json(500, { error: (e as Error).message });
    }
});
