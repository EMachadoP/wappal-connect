-- 20260120_fix_lid_normalization.sql
-- Adiciona campos e índices para LID
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lid TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_lid ON contacts(lid) WHERE lid IS NOT NULL;

-- Remove the unique constraint if it already exists to avoid errors on recreate
DROP INDEX IF EXISTS idx_contacts_phone_lid;
CREATE UNIQUE INDEX idx_contacts_phone_lid ON contacts(phone, lid) WHERE phone IS NOT NULL AND lid IS NOT NULL;

-- Função de normalização de Chat ID
CREATE OR REPLACE FUNCTION normalize_chat_identifier(raw_input TEXT, is_group BOOLEAN DEFAULT FALSE)
RETURNS TEXT AS $$
DECLARE
  cleaned TEXT;
  digits TEXT;
BEGIN
  -- Remove espaços e lowercase
  cleaned := LOWER(TRIM(raw_input));
  
  -- Se termina com @lid, preserva
  IF cleaned LIKE '%@lid' THEN
    RETURN cleaned;
  END IF;
  
  -- Grupos sempre terminam com @g.us
  IF is_group OR cleaned LIKE '%@g.us%' OR cleaned LIKE '%--%' THEN
    cleaned := REGEXP_REPLACE(cleaned, '-group$', '');
    IF cleaned !~ '@g\.us$' THEN
      cleaned := SPLIT_PART(cleaned, '@', 1) || '@g.us';
    END IF;
    RETURN cleaned;
  END IF;
  
  -- Usuários: apenas dígitos
  digits := REGEXP_REPLACE(SPLIT_PART(cleaned, '@', 1), '\D', '', 'g');
  
  -- Se tem 14+ dígitos e NÃO começa com 55 (Brasil), é LID inválido
  IF LENGTH(digits) >= 14 AND LEFT(digits, 2) != '55' THEN
    RETURN NULL;
  END IF;
  
  -- Normaliza telefone brasileiro
  IF LENGTH(digits) IN (10, 11) THEN
    digits := '55' || digits;
  END IF;
  
  -- Se não tem dígitos suficientes, retorna NULL
  IF LENGTH(digits) < 10 THEN
    RETURN NULL;
  END IF;
  
  RETURN digits || '@s.whatsapp.net';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Limpa duplicatas existentes (mantém o mais recente)
WITH ranked AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(phone, chat_lid) 
      ORDER BY updated_at DESC, created_at DESC
    ) as rn
  FROM contacts
  WHERE phone IS NOT NULL OR chat_lid IS NOT NULL
)
DELETE FROM contacts WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);
