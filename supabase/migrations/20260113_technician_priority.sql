-- Add dispatch_priority to technicians
-- 100 is the default (normal priority)
-- Higher values (e.g. 300) mean "wildcard" (André)
-- Lower values (e.g. 50) mean "prioritize this technician"

ALTER TABLE technicians 
ADD COLUMN IF NOT EXISTS dispatch_priority INT NOT NULL DEFAULT 100;

-- Optional: Set André as coringa if he exists
UPDATE technicians 
SET dispatch_priority = 300 
WHERE name ILIKE '%André%';
