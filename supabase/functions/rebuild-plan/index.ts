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

interface WorkItem {
    id: string;
    category: string;
    priority: string;
    title: string;
    estimated_minutes: number;
    required_skill_codes: string[];
}

interface Technician {
    id: string;
    name: string;
    skills: string[];
}

interface SlotAllocation {
    technician_id: string;
    start_minute: number;
    end_minute: number;
}

// Priority order (higher = more urgent)
const PRIORITY_ORDER: Record<string, number> = {
    urgent: 4,
    high: 3,
    normal: 2,
    low: 1,
};

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

    console.log('--- [rebuild-plan] START ---');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    try {
        const body = await req.json();
        const startDate: string = body.start_date; // YYYY-MM-DD
        const days: number = body.days || 7;

        if (!startDate) {
            return json(400, { error: 'start_date is required (YYYY-MM-DD)' });
        }

        // Calculate end date
        const start = new Date(startDate);
        const end = new Date(start);
        end.setDate(end.getDate() + days - 1);
        const endDate = end.toISOString().split('T')[0];

        console.log(`[rebuild-plan] Planning ${startDate} to ${endDate} (${days} days)`);

        // 1. Acquire lock (simple table-based lock)
        const lockKey = `plan:${startDate}:${days}`;
        const { error: lockErr } = await supabase
            .from('planner_locks')
            .insert({ lock_key: lockKey })
            .select();

        if (lockErr?.code === '23505') { // unique constraint violation
            console.log('[rebuild-plan] Another rebuild is running for this interval');
            return json(409, { error: 'Another rebuild is running for this interval' });
        }

        try {
            // 2. Delete existing plan items in range
            console.log('[rebuild-plan] Deleting existing plan items...');
            await supabase
                .from('plan_items')
                .delete()
                .gte('plan_date', startDate)
                .lte('plan_date', endDate);

            // 3. Get open work items (not yet planned)
            console.log('[rebuild-plan] Fetching open work items...');
            const { data: workItems, error: wiErr } = await supabase
                .from('protocol_work_items')
                .select('*')
                .eq('status', 'open')
                .order('created_at', { ascending: true });

            if (wiErr) throw wiErr;

            if (!workItems || workItems.length === 0) {
                console.log('[rebuild-plan] No open work items to schedule');
                return json(200, { success: true, scheduled: 0, message: 'No work items to schedule' });
            }

            // Sort by priority (descending) then created_at
            workItems.sort((a, b) => {
                const pa = PRIORITY_ORDER[a.priority] || 2;
                const pb = PRIORITY_ORDER[b.priority] || 2;
                if (pb !== pa) return pb - pa;
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });

            console.log(`[rebuild-plan] ${workItems.length} work items to schedule`);

            // 4. Get active technicians with skills
            const { data: technicians, error: techErr } = await supabase
                .from('technicians')
                .select(`
          id,
          name,
          technician_skills (
            skills (code)
          )
        `)
                .eq('is_active', true);

            if (techErr) throw techErr;

            if (!technicians || technicians.length === 0) {
                console.log('[rebuild-plan] No active technicians found');
                return json(200, { success: true, scheduled: 0, message: 'No technicians available' });
            }

            // Map technicians with their skill codes
            const techWithSkills: Technician[] = technicians.map((t: any) => ({
                id: t.id,
                name: t.name,
                skills: (t.technician_skills || []).map((ts: any) => ts.skills?.code).filter(Boolean),
            }));

            console.log(`[rebuild-plan] ${techWithSkills.length} technicians available`);

            // 5. Build schedule per day
            const planItems: any[] = [];
            const scheduledWorkItemIds: string[] = [];

            // Track allocations per technician per day
            const allocations = new Map<string, SlotAllocation[]>(); // key: techId:date

            for (let d = 0; d < days; d++) {
                const currentDate = new Date(start);
                currentDate.setDate(currentDate.getDate() + d);
                const dateStr = currentDate.toISOString().split('T')[0];

                for (const wi of workItems) {
                    if (scheduledWorkItemIds.includes(wi.id)) continue;

                    // Find compatible technician with available slot
                    const requiredSkills = wi.required_skill_codes || [];

                    for (const tech of techWithSkills) {
                        // Check skill compatibility (technician has ALL required skills)
                        const hasSkills = requiredSkills.length === 0 ||
                            requiredSkills.every(s => tech.skills.includes(s));

                        if (!hasSkills) continue;

                        // Get existing allocations for this tech on this day
                        const key = `${tech.id}:${dateStr}`;
                        const dayAllocs = allocations.get(key) || [];

                        // Find first available slot
                        const slot = findAvailableSlot(dayAllocs, wi.estimated_minutes);

                        if (slot) {
                            // Allocate
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
                            scheduledWorkItemIds.push(wi.id);
                            break; // Move to next work item
                        }
                    }
                }
            }

            console.log(`[rebuild-plan] Created ${planItems.length} plan items`);

            // 6. Insert plan items
            if (planItems.length > 0) {
                const { error: insertErr } = await supabase
                    .from('plan_items')
                    .insert(planItems);

                if (insertErr) throw insertErr;

                // 7. Update work items status to 'planned'
                const { error: updateErr } = await supabase
                    .from('protocol_work_items')
                    .update({ status: 'planned' })
                    .in('id', scheduledWorkItemIds);

                if (updateErr) {
                    console.warn('[rebuild-plan] Failed to update work item status:', updateErr.message);
                }
            }

            console.log('--- [rebuild-plan] SUCCESS ---');
            return json(200, {
                success: true,
                scheduled: planItems.length,
                remaining: workItems.length - scheduledWorkItemIds.length,
                date_range: { start: startDate, end: endDate },
            });

        } finally {
            // Release lock
            await supabase
                .from('planner_locks')
                .delete()
                .eq('lock_key', lockKey);
        }

    } catch (e) {
        console.error('[rebuild-plan] Error:', (e as Error).message);
        return json(500, { error: (e as Error).message });
    }
});

// Find first available slot in the working hours
function findAvailableSlot(
    existingAllocations: SlotAllocation[],
    durationMinutes: number
): SlotAllocation | null {
    // Sort existing by start time
    const sorted = [...existingAllocations].sort((a, b) => a.start_minute - b.start_minute);

    // Try morning slot
    let candidate = MORNING_START;
    for (const alloc of sorted) {
        if (alloc.end_minute <= MORNING_START) continue;
        if (alloc.start_minute >= MORNING_END) break;

        if (candidate + durationMinutes <= alloc.start_minute && candidate + durationMinutes <= MORNING_END) {
            return { technician_id: '', start_minute: candidate, end_minute: candidate + durationMinutes };
        }
        candidate = Math.max(candidate, alloc.end_minute);
    }

    // Check if remaining morning time fits
    if (candidate < MORNING_END && candidate + durationMinutes <= MORNING_END) {
        return { technician_id: '', start_minute: candidate, end_minute: candidate + durationMinutes };
    }

    // Try afternoon slot
    candidate = AFTERNOON_START;
    for (const alloc of sorted) {
        if (alloc.end_minute <= AFTERNOON_START) continue;
        if (alloc.start_minute >= AFTERNOON_END) break;

        if (candidate + durationMinutes <= alloc.start_minute && candidate + durationMinutes <= AFTERNOON_END) {
            return { technician_id: '', start_minute: candidate, end_minute: candidate + durationMinutes };
        }
        candidate = Math.max(candidate, alloc.end_minute);
    }

    // Check if remaining afternoon time fits
    if (candidate < AFTERNOON_END && candidate + durationMinutes <= AFTERNOON_END) {
        return { technician_id: '', start_minute: candidate, end_minute: candidate + durationMinutes };
    }

    return null; // No slot available
}
