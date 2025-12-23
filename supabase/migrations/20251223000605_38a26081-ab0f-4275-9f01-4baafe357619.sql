-- Add global schedule to ai_settings
ALTER TABLE public.ai_settings 
ADD COLUMN IF NOT EXISTS schedule_json jsonb DEFAULT '{
  "days": {
    "monday": {"enabled": true, "start": "08:00", "end": "18:00"},
    "tuesday": {"enabled": true, "start": "08:00", "end": "18:00"},
    "wednesday": {"enabled": true, "start": "08:00", "end": "18:00"},
    "thursday": {"enabled": true, "start": "08:00", "end": "18:00"},
    "friday": {"enabled": true, "start": "08:00", "end": "18:00"},
    "saturday": {"enabled": true, "start": "08:00", "end": "12:00"},
    "sunday": {"enabled": false, "start": "08:00", "end": "12:00"}
  },
  "exceptions": []
}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.ai_settings.schedule_json IS 'Global AI schedule applied when conversation has no team-specific settings';