-- Migration: Task Template Refinement
-- Adds match_priority and unique constraint for idempotency

-- 1) Add match_priority column
ALTER TABLE task_templates 
ADD COLUMN IF NOT EXISTS match_priority INT DEFAULT 0;

-- 2) Create unique index for idempotency (UPSERT support)
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_templates_key
ON task_templates (category, title);

-- 3) Clean up column names for clarity (optional, but ensures alignment)
-- Already handled by using actual column names in seed script.
