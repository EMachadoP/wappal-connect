// Employee detection via profile_whatsapp_ids mapping

import { candidateSenderIds, isLid, isPurePhone } from "./wa-id.ts";

type SupabaseClient = any;

export type EmployeeMatch = {
    isEmployee: boolean;
    profileId?: string;
    profileName?: string;
    roles?: string[];
    matchedId?: string;
};

export async function isEmployeeSender(
    supabase: SupabaseClient,
    payload: any
): Promise<EmployeeMatch> {
    const ids = candidateSenderIds(payload);
    if (ids.length === 0) return { isEmployee: false };

    // LID-first ordering
    const ordered = [
        ...ids.filter((x) => isLid(x)),
        ...ids.filter((x) => isPurePhone(x)),
        ...ids,
    ];

    for (const waId of ordered) {
        // Lookup in mapping table
        const { data: maps } = await supabase
            .from("profile_whatsapp_ids")
            .select("profile_id, wa_id")
            .eq("wa_id", waId)
            .eq("is_active", true)
            .limit(1);

        const map = maps?.[0];
        if (!map) continue;

        // Get profile name
        const { data: profs } = await supabase
            .from("profiles")
            .select("id, name")
            .eq("id", map.profile_id)
            .limit(1);

        const profile = profs?.[0];

        // Get roles (1:N relationship)
        const { data: rolesRows } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", map.profile_id);

        const roles = (rolesRows ?? []).map((r: any) => r.role).filter(Boolean);

        return {
            isEmployee: true,
            profileId: map.profile_id,
            profileName: profile?.name ?? "Funcionário",
            roles,
            matchedId: waId,
        };
    }

    return { isEmployee: false };
}
