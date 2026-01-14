// Employee detection via phone lookup

import { onlyDigits } from "./ids.ts";

export type EmployeeMatch = {
    isEmployee: boolean;
    profileId?: string;
    senderPhone?: string;
    profileName?: string;
};

/**
 * Checks if message sender is an employee (technician sending via personal WhatsApp).
 * Uses employee_phones table to map phone -> profile_id.
 */
export async function isEmployeeSender(
    supabaseAdmin: any,
    payload: any
): Promise<EmployeeMatch> {
    // Extract sender phone from payload
    const senderPhone = onlyDigits(
        payload?.senderPhone ?? payload?.phone ?? payload?.from ?? ""
    );

    if (!senderPhone) {
        return { isEmployee: false };
    }

    // Lookup in employee_phones table
    const { data, error } = await supabaseAdmin
        .from("employee_phones")
        .select("profile_id, is_active")
        .eq("phone", senderPhone)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

    if (error || !data) {
        return { isEmployee: false };
    }

    // Get profile name
    const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("name")
        .eq("id", data.profile_id)
        .maybeSingle();

    return {
        isEmployee: true,
        profileId: data.profile_id,
        senderPhone,
        profileName: profile?.name ?? "Funcionário",
    };
}
