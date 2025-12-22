-- Create zapi_settings table for Z-API configuration
CREATE TABLE public.zapi_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  zapi_instance_id text,
  zapi_token text,
  zapi_security_token text,
  open_tickets_group_id text, -- formato ...@g.us
  enable_group_notifications boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id)
);

-- Create notifications table for deduplication and audit
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  notification_type text NOT NULL DEFAULT 'ticket_created',
  status text NOT NULL DEFAULT 'pending', -- pending, sent, failed
  zapi_response_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add protocol field to conversations if we need to track ticket numbers
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS protocol text UNIQUE;

-- Enable RLS
ALTER TABLE public.zapi_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS policies for zapi_settings
CREATE POLICY "Admins can manage zapi_settings"
ON public.zapi_settings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view zapi_settings"
ON public.zapi_settings FOR SELECT
USING (true);

-- RLS policies for notifications
CREATE POLICY "Admins can manage notifications"
ON public.notifications FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view notifications for accessible conversations"
ON public.notifications FOR SELECT
USING (can_access_conversation(auth.uid(), conversation_id));

-- Create indexes
CREATE INDEX idx_notifications_dedupe_key ON public.notifications(dedupe_key);
CREATE INDEX idx_notifications_conversation_id ON public.notifications(conversation_id);
CREATE INDEX idx_zapi_settings_team_id ON public.zapi_settings(team_id);

-- Trigger for updated_at
CREATE TRIGGER update_zapi_settings_updated_at
BEFORE UPDATE ON public.zapi_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to generate protocol number
CREATE OR REPLACE FUNCTION public.generate_protocol()
RETURNS TRIGGER AS $$
DECLARE
  year_month text;
  sequence_num integer;
BEGIN
  -- Only generate if protocol is null and status is 'open'
  IF NEW.protocol IS NULL THEN
    year_month := to_char(now(), 'YYYYMM');
    
    -- Get next sequence number for this month
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(protocol FROM '[0-9]+$') AS integer)
    ), 0) + 1
    INTO sequence_num
    FROM public.conversations
    WHERE protocol LIKE year_month || '-%';
    
    NEW.protocol := year_month || '-' || LPAD(sequence_num::text, 4, '0');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Trigger to auto-generate protocol on new conversations
CREATE TRIGGER generate_conversation_protocol
BEFORE INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.generate_protocol();