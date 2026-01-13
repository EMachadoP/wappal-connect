-- Migration to support Task/Work Item conclusion flow
-- 1. Add tracking fields to protocol_work_items
ALTER TABLE public.protocol_work_items 
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Add completion tracking to plan_items (optional but good for history)
ALTER TABLE public.plan_items
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 3. Trigger to auto-resolve protocol when all work items are done
CREATE OR REPLACE FUNCTION public.check_all_work_items_done()
RETURNS TRIGGER AS $$
DECLARE
    all_done BOOLEAN;
BEGIN
    -- Only proceed if the status changed to 'done'
    IF NEW.status = 'done' THEN
        -- Check if any other work items for this protocol are NOT done
        SELECT NOT EXISTS (
            SELECT 1 FROM public.protocol_work_items 
            WHERE protocol_id = NEW.protocol_id 
            AND status <> 'done'
        ) INTO all_done;
        
        IF all_done THEN
            UPDATE public.protocols 
            SET status = 'resolved', 
                updated_at = now() 
            WHERE id = NEW.protocol_id 
            AND status = 'open'; -- Only move from 'open' to 'resolved'
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_resolve_protocol ON public.protocol_work_items;
CREATE TRIGGER trg_auto_resolve_protocol
AFTER UPDATE OF status ON public.protocol_work_items
FOR EACH ROW EXECUTE FUNCTION public.check_all_work_items_done();
