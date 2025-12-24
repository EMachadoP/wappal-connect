
-- 1) RLS policies for SELECT on conversations and messages for all authenticated agents

-- conversations - allow all authenticated to SELECT
DROP POLICY IF EXISTS "conversations_select_all_agents" ON public.conversations;
CREATE POLICY "conversations_select_all_agents"
ON public.conversations
FOR SELECT
TO authenticated
USING (true);

-- messages - allow all authenticated to SELECT
DROP POLICY IF EXISTS "messages_select_all_agents" ON public.messages;
CREATE POLICY "messages_select_all_agents"
ON public.messages
FOR SELECT
TO authenticated
USING (true);

-- 2) Unique index to prevent duplicate open conversations per thread_key
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_open_thread
ON public.conversations(thread_key)
WHERE status = 'open';
