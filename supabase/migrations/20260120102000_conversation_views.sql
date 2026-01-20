-- 20260120_conversation_views.sql

-- Drop existing if exists to allow clean recreate
DROP TRIGGER IF EXISTS refresh_inbox_on_conversation_change ON conversations;
DROP FUNCTION IF EXISTS refresh_conversation_inbox();
DROP MATERIALIZED VIEW IF EXISTS conversation_inbox;

CREATE MATERIALIZED VIEW conversation_inbox AS
SELECT 
  c.*,
  co.name as contact_name,
  co.phone,
  co.lid,
  CASE 
    WHEN c.status = 'resolved' THEN 'resolved'
    WHEN c.assigned_to IS NOT NULL THEN 'assigned'
    ELSE 'inbox'
  END as tab_category
FROM conversations c
JOIN contacts co ON c.contact_id = co.id
WHERE c.status IN ('open', 'pending', 'resolved');

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_inbox_id ON conversation_inbox(id);
CREATE INDEX IF NOT EXISTS idx_conversation_inbox_tab_category ON conversation_inbox(tab_category);
CREATE INDEX IF NOT EXISTS idx_conversation_inbox_assigned_to ON conversation_inbox(assigned_to);

-- Trigger para atualização automática
CREATE OR REPLACE FUNCTION refresh_conversation_inbox()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY conversation_inbox;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refresh_inbox_on_conversation_change
AFTER INSERT OR UPDATE OR DELETE ON conversations
FOR EACH STATEMENT EXECUTE FUNCTION refresh_conversation_inbox();
