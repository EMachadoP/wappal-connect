-- =====================================================
-- SYNC ENTITIES AND CONDOMINIUMS TABLES
-- =====================================================
-- This migration ensures that all condominium entities are properly synced
-- to the condominiums table to satisfy FK constraints in protocols table.

-- Step 1: Sync existing data
-- Insert all entities with type='condominio' into condominiums table
-- Using ON CONFLICT DO NOTHING to avoid errors on duplicates
INSERT INTO public.condominiums (id, name, created_at, updated_at)
SELECT 
  id, 
  name, 
  created_at, 
  updated_at
FROM public.entities
WHERE type = 'condominio'
ON CONFLICT (id) DO NOTHING;

-- Step 2: Create function to automatically sync entities to condominiums
CREATE OR REPLACE FUNCTION public.sync_entity_to_condominium()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only sync if the entity is a condominium
  IF NEW.type = 'condominio' THEN
    -- Insert into condominiums table (or update if exists)
    INSERT INTO public.condominiums (id, name, created_at, updated_at)
    VALUES (NEW.id, NEW.name, NEW.created_at, NEW.updated_at)
    ON CONFLICT (id) DO UPDATE
    SET 
      name = EXCLUDED.name,
      updated_at = EXCLUDED.updated_at;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Step 3: Create trigger to call the function on INSERT and UPDATE
DROP TRIGGER IF EXISTS sync_entity_to_condominium_trigger ON public.entities;

CREATE TRIGGER sync_entity_to_condominium_trigger
AFTER INSERT OR UPDATE ON public.entities
FOR EACH ROW
WHEN (NEW.type = 'condominio')
EXECUTE FUNCTION public.sync_entity_to_condominium();

-- Add comment for documentation
COMMENT ON FUNCTION public.sync_entity_to_condominium() IS 
'Automatically syncs entity records of type ''condominio'' to the condominiums table to maintain FK constraint integrity with protocols table';
