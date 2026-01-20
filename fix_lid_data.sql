DO $$
DECLARE
  v_phone text := '558197438430';
  v_phone_jid text := public.normalize_chat_id(v_phone);
  v_phone_key text := public.normalize_chat_key(v_phone);
  v_lid text := '144723385778292@lid';
  v_lid_as_jid text := '144723385778292@s.whatsapp.net';
  v_conv_phone uuid;
  v_conv_lid uuid;
BEGIN
  SELECT id INTO v_conv_phone FROM public.conversations WHERE chat_id = v_phone_jid LIMIT 1;
  SELECT id INTO v_conv_lid   FROM public.conversations WHERE chat_id = v_lid LIMIT 1;

  RAISE NOTICE 'Phone JID: %, Key: %, LID: %', v_phone_jid, v_phone_key, v_lid;
  RAISE NOTICE 'Found Phone Conv: %, Found LID Conv: %', v_conv_phone, v_conv_lid;

  IF v_conv_lid IS NOT NULL THEN
    IF v_conv_phone IS NULL THEN
      UPDATE public.conversations
         SET chat_id = v_phone_jid,
             thread_key = v_phone_key,
             updated_at = now()
       WHERE id = v_conv_lid;
      v_conv_phone := v_conv_lid;
      RAISE NOTICE 'Updated LID conversation to Phone identity';
    ELSE
      UPDATE public.messages
         SET conversation_id = v_conv_phone,
             chat_id = v_phone_jid
       WHERE conversation_id = v_conv_lid;

      DELETE FROM public.conversations WHERE id = v_conv_lid;
      RAISE NOTICE 'Merged LID conversation messages into Phone conversation and deleted LID conversation';
    END IF;
  END IF;

  UPDATE public.messages
     SET chat_id = v_phone_jid
   WHERE chat_id = v_lid
      OR chat_id = v_lid_as_jid;
   
  RAISE NOTICE 'Updated orphan messages identities';
END $$;
