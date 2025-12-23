-- Unique index: prevent duplicate group contacts with same chat_lid
CREATE UNIQUE INDEX IF NOT EXISTS contacts_group_chat_lid_unique
ON public.contacts (chat_lid)
WHERE is_group = true AND chat_lid IS NOT NULL;

-- Unique index: prevent duplicate messages by whatsapp_message_id
CREATE UNIQUE INDEX IF NOT EXISTS messages_whatsapp_message_id_unique
ON public.messages (whatsapp_message_id)
WHERE whatsapp_message_id IS NOT NULL;