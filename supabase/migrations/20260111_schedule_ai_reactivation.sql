-- Migration: Schedule AI auto-reactivation via pg_cron
-- Created: 2026-01-11
-- Purpose: Automatically call resume_expired_ai_pauses() every 5 minutes

-- First, ensure the function exists (from previous migration)
-- This should already be created by 20260109_resume_ai_after_timeout.sql

-- Schedule job to run every 5 minutes
-- The function checks for expired ai_paused_until and reactivates AI for non-suppliers
SELECT cron.unschedule('resume-ai-pauses'); -- Remove if exists
SELECT cron.schedule(
  'resume-ai-pauses',
  '*/5 * * * *',  -- Every 5 minutes
  $$SELECT resume_expired_ai_pauses()$$
);

-- Comment
COMMENT ON EXTENSION pg_cron IS 'Job scheduler for PostgreSQL - used for AI auto-reactivation';
