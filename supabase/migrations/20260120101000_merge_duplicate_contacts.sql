-- 20260120_merge_duplicate_contacts.sql
CREATE OR REPLACE FUNCTION merge_duplicate_contacts()
RETURNS void AS $$
DECLARE
  dup RECORD;
  keeper_id UUID;
BEGIN
  -- Itera sobre grupos de contatos com mesmo phone ou lid
  FOR dup IN 
    SELECT 
      COALESCE(phone, lid) as identifier,
      ARRAY_AGG(id ORDER BY updated_at DESC) as ids
    FROM contacts
    WHERE (phone IS NOT NULL OR lid IS NOT NULL)
    GROUP BY COALESCE(phone, lid)
    HAVING COUNT(*) > 1
  LOOP
    keeper_id := dup.ids[1]; -- Mantém o mais recente
    
    -- Atualiza referências em conversations
    UPDATE conversations 
    SET contact_id = keeper_id
    WHERE contact_id = ANY(dup.ids[2:]);
    
    -- Atualiza referências em messages (usando sender_id se existir, senão phone)
    -- Nota: A tabela messages parece usar conversation_id na maioria dos casos,
    -- mas vamos garantir a consistência se houver sender_phone.
    
    -- Remove duplicatas
    DELETE FROM contacts WHERE id = ANY(dup.ids[2:]);
    
    RAISE NOTICE 'Merged % contacts for identifier %', array_length(dup.ids, 1), dup.identifier;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Executa a limpeza
SELECT merge_duplicate_contacts();
