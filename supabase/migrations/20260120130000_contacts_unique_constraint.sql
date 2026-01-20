-- Add unique constraints to prevent duplicate contacts by phone or LID
-- This ensures that each phone number and each LID can only exist once

-- Add unique constraint on phone (if not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_phone_unique 
  ON contacts(phone) 
  WHERE phone IS NOT NULL;

COMMENT ON INDEX idx_contacts_phone_unique IS 
  'Ensures each phone number appears only once in contacts table';

-- Add unique constraint on lid (if not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_lid_unique 
  ON contacts(lid) 
  WHERE lid IS NOT NULL;

COMMENT ON INDEX idx_contacts_lid_unique IS 
  'Ensures each LID appears only once in contacts table';

-- Note: We use partial indexes (WHERE ... IS NOT NULL) because:
-- 1. NULL values are allowed (some contacts may not have phone/lid yet)
-- 2. Multiple NULL values don't violate uniqueness
-- 3. Better performance than a full index
