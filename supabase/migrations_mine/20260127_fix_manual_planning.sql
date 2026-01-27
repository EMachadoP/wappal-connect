-- FIX: Remover NOT NULL de work_item_id para permitir agendamentos manuais
ALTER TABLE plan_items ALTER COLUMN work_item_id DROP NOT NULL;

-- Notificar PostgREST para recarregar o cache do schema (correção do erro 'column not found')
NOTIFY pgrst, 'reload schema';
