
export interface DisplayContact {
    name: string;
    group_name?: string | null;
    is_group?: boolean;
    phone?: string | null;
    participants?: DisplayParticipant[];
}

export interface DisplayParticipant {
    name: string;
    is_primary?: boolean;
}

/**
 * Unifies the logic for displaying a chat/contact name across the app.
 * Priority:
 * 1. Primary participant name (if identified)
 * 2. Group name (if it's a group)
 * 3. Contact name (raw name from WhatsApp/Provider)
 * 4. Phone number (if available)
 * 5. Fallback "Sem Nome"
 */
export function getChatDisplayName(
    contact?: DisplayContact | null,
    participant?: DisplayParticipant | null,
    title?: string | null,
    chatId?: string | null
): string {
    // 1. Prioritize explicitly passed participant name (identified sender)
    if (participant?.name) {
        return participant.name;
    }

    // 2. If no participant passed, check if contact has participants joined
    if (contact?.participants && contact.participants.length > 0) {
        const primaryParticipant = contact.participants.find(p => p.is_primary);
        if (primaryParticipant?.name) {
            return primaryParticipant.name;
        }
        // Fallback to first participant if no primary
        if (contact.participants[0].name) {
            return contact.participants[0].name;
        }
    }

    // 3. Handle groups
    if (contact?.is_group && contact.group_name) {
        return contact.group_name;
    }

    // 4. Fallback to contact name
    if (contact?.name && contact.name !== 'Contact' && contact.name !== 'Unknown') {
        return contact.name;
    }

    // 5. Fallback to conversation title (Denormalized)
    if (title && title !== 'Sem Nome' && title !== 'Grupo') {
        return title;
    }

    // 6. Fallback to phone
    if (contact?.phone) {
        return contact.phone;
    }

    // 7. Fallback to chatId (cleaned)
    if (chatId) {
        return chatId.split('@')[0];
    }

    return "Sem Nome";
}
