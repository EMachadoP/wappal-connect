-- Migration: Advanced Task Templates and Assignment Groups
-- Created: 2026-01-13

-- 1) Add match_keywords to task_templates
ALTER TABLE task_templates 
ADD COLUMN IF NOT EXISTS match_keywords text[] DEFAULT '{}';

-- 2) Add assignment_group_id to plan_items and protocol_work_items
-- This allows grouping multiple technician assignments into a single visual card
ALTER TABLE plan_items 
ADD COLUMN IF NOT EXISTS assignment_group_id uuid;

ALTER TABLE protocol_work_items
ADD COLUMN IF NOT EXISTS assignment_group_id uuid;

-- 3) Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_plan_items_assignment_group 
ON plan_items (assignment_group_id);

CREATE INDEX IF NOT EXISTS idx_task_templates_keywords 
ON task_templates USING gin (match_keywords);
