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
            console.error('[rebuild-plan] Missing environment variables');
            return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
        }

        const admin = createClient(supabaseUrl, serviceRoleKey);

        // 1. Authenticate the user calling this
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            console.error('[rebuild-plan] No Authorization header');
            return json(401, { error: 'Missing Authorization header' });
        }

        const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
        if (authErr || !user) {
            console.error('[rebuild-plan] Invalid JWT:', authErr?.message);
            return json(401, { error: 'Invalid JWT', details: authErr?.message });
        }

        console.log(`[rebuild-plan] User authenticated: ${user.id}`);

        // 2. Parse request body
        const { start_date, days = 7 } = await req.json().catch(() => ({}));
        if (!start_date) {
            return json(400, { error: "start_date is required (YYYY-MM-DD)" });
        }

        // Calculate end date
        const start = new Date(start_date);
        const end = new Date(start);
        end.setDate(end.getDate() + days - 1);
        const endDate = end.toISOString().split('T')[0];

        console.log(`[rebuild-plan] Interval: ${start_date} to ${endDate}`);

        // 3. Acquire lock
        const lockKey = `plan:${start_date}:${days}`;
        const { error: lockErr } = await admin.from('planner_locks').insert({ lock_key: lockKey });
        if (lockErr) {
            if (lockErr.code === '23505') {
                return json(409, { error: "Another rebuild is already running for this period" });
            }
            return json(500, { error: "Failed to acquire lock", details: lockErr });
        }

        try {
            // 4. Delete existing items
            console.log('[rebuild-plan] Deleting existing plan items...');
            const { error: delErr } = await admin
                .from('plan_items')
                .delete()
                .gte('plan_date', start_date)
                .lte('plan_date', endDate);

            if (delErr) {
                console.error('[rebuild-plan] Delete failed:', delErr);
                return json(403, { error: "Delete plan_items failed (RLS or Permission)", details: delErr });
            }

            // 5. Fetch Work Items
            console.log('[rebuild-plan] Fetching work items...');
            const { data: workItems, error: wiErr } = await admin
                .from('protocol_work_items')
                .select('*')
                .eq('status', 'open');

            if (wiErr) {
                console.error('[rebuild-plan] Work items fetch failed:', wiErr);
                return json(403, { error: "Fetch protocol_work_items failed", details: wiErr });
            }

            if (!workItems || workItems.length === 0) {
                return json(200, { ok: true, scheduled: 0, message: "No open work items" });
            }

            // Sort: Critical -> Due Date -> Priority -> Created At
            workItems.sort((a, b) => {
                const critA = a.criticality === 'critical' ? 1 : 0;
                const critB = b.criticality === 'critical' ? 1 : 0;
                if (critB !== critA) return critB - critA;

                const dueA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
                const dueB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
                if (dueA !== dueB) return dueA - dueB;

                const pa = PRIORITY_ORDER[a.priority] || 2;
                const pb = PRIORITY_ORDER[b.priority] || 2;
                if (pb !== pa) return pb - pa;

                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });

            // 6. Fetch Technicians
            console.log('[rebuild-plan] Fetching technicians...');
            const { data: technicians, error: techErr } = await admin
                .from('technicians')
                .select('id, name, technician_skills(skills(code))')
                .eq('is_active', true);

            if (techErr) {
                console.error('[rebuild-plan] Technicians fetch failed:', techErr);
                return json(403, { error: "Fetch technicians failed", details: techErr });
            }

            const techWithSkills = technicians.map((t: any) => ({
                id: t.id,
                name: t.name,
                skills: (t.technician_skills || []).map((ts: any) => ts.skills?.code).filter(Boolean),
            }));

            // 7. Allocation Algorithm
            console.log('[rebuild-plan] Running allocation algorithm...');
            const planItems: any[] = [];
            const scheduledIds: string[] = [];
            const allocations = new Map<string, SlotAllocation[]>();

            for (let d = 0; d < days; d++) {
                const currentDate = new Date(start);
                currentDate.setDate(currentDate.getDate() + d);
                const dateStr = currentDate.toISOString().split('T')[0];

                for (const wi of workItems) {
                    if (scheduledIds.includes(wi.id)) continue;

                    const requiredSkills = wi.required_skill_codes || [];

                    for (const tech of techWithSkills) {
                        const hasSkills = requiredSkills.length === 0 ||
                            requiredSkills.every((s: string) => tech.skills.includes(s));

                        if (!hasSkills) continue;

                        const key = `${tech.id}:${dateStr}`;
                        const dayAllocs = allocations.get(key) || [];
                        const slot = findAvailableSlot(dayAllocs, wi.estimated_minutes);

                        if (slot) {
                            planItems.push({
                                plan_date: dateStr,
                                technician_id: tech.id,
                                work_item_id: wi.id,
                                start_minute: slot.start_minute,
                                end_minute: slot.end_minute,
                                sequence: dayAllocs.length,
                            });
                            dayAllocs.push(slot);
                            allocations.set(key, dayAllocs);
                            scheduledIds.push(wi.id);
                            break;
                        }
                    }
                }
            }

            // 8. Bulk Insert & Update
            if (planItems.length > 0) {
                console.log(`[rebuild-plan] Inserting ${planItems.length} items...`);
                const { error: insErr } = await admin.from('plan_items').insert(planItems);
                if (insErr) {
                    console.error('[rebuild-plan] Insert failed:', insErr);
                    return json(403, { error: "Insert plan_items failed", details: insErr });
                }

                await admin.from('protocol_work_items')
                    .update({ status: 'planned' })
                    .in('id', scheduledIds);
            }

            console.log('[rebuild-plan] SUCCESS');
            return json(200, { ok: true, scheduled: planItems.length });

        } finally {
            await admin.from('planner_locks').delete().eq('lock_key', lockKey);
        }

    } catch (e) {
        console.error('[rebuild-plan] Catch:', e);
        return json(500, { error: "Unhandled internal error", details: String(e) });
    }
});

function findAvailableSlot(existing: SlotAllocation[], duration: number): SlotAllocation | null {
    const sorted = [...existing].sort((a, b) => a.start_minute - b.start_minute);

    // Check morning
    let candidate = MORNING_START;
    for (const a of sorted) {
        if (a.end_minute <= MORNING_START) continue;
        if (a.start_minute >= MORNING_END) break;
        if (candidate + duration <= a.start_minute) return { technician_id: '', start_minute: candidate, end_minute: candidate + duration };
        candidate = Math.max(candidate, a.end_minute);
    }
    if (candidate + duration <= MORNING_END) return { technician_id: '', start_minute: candidate, end_minute: candidate + duration };

    // Check afternoon
    candidate = AFTERNOON_START;
    for (const a of sorted) {
        if (a.end_minute <= AFTERNOON_START) continue;
        if (a.start_minute >= AFTERNOON_END) break;
        if (candidate + duration <= a.start_minute) return { technician_id: '', start_minute: candidate, end_minute: candidate + duration };
        candidate = Math.max(candidate, a.end_minute);
    }
    if (candidate + duration <= AFTERNOON_END) return { technician_id: '', start_minute: candidate, end_minute: candidate + duration };

    return null;
}
