
-- Keep conversations.last_message_at in sync with incoming messages

CREATE OR REPLACE FUNCTION public.update_conversation_last_message_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update last_message_at for the conversation whenever a new message arrives.
  UPDATE public.conversations
  SET last_message_at = GREATEST(COALESCE(last_message_at, '1970-01-01'::timestamptz), NEW.sent_at),
      updated_at = now()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_set_conversation_last_message_at ON public.messages;
CREATE TRIGGER trg_messages_set_conversation_last_message_at
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_last_message_at();
