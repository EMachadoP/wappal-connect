-- ============================================
-- MIGRATION: Create profile_whatsapp_ids table
-- Maps WhatsApp IDs (phone/LID) to system profiles
-- ============================================

create table if not exists profile_whatsapp_ids (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  wa_id text not null,
  wa_type text not null default 'phone',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_profile_whatsapp_ids_wa_id
  on profile_whatsapp_ids(wa_id)
  where is_active = true;

create index if not exists ix_profile_whatsapp_ids_profile
  on profile_whatsapp_ids(profile_id);
