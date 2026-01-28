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
    // ✅ Modo Operador desativado temporariamente para evitar vazamentos
    return { isEmployee: false };
}
