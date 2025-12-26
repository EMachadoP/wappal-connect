import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function logAuditAction(supabase: any, {
  actor_id,
  action,
  entity_type,
  entity_id,
  old_data = null,
  new_data = null
}: {
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  old_data?: any;
  new_data?: any;
}) {
  const { error } = await supabase
    .from('audit_logs')
    .insert({
      actor_id,
      action,
      entity_type,
      entity_id,
      old_data,
      new_data
    });

  if (error) console.error('[Audit] Failed to log action:', error);
}