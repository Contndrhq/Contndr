-- Durable analytics storage for Contndr.
-- KV should stay limited to short-lived cache, locks, rate limits, and transient state.

create table if not exists public.admin_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  event_type text not null,
  title text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.visitor_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  visitor_id text not null,
  session_id text not null,
  lead_id uuid,
  campaign_id uuid,
  last_url text,
  city text,
  region text,
  country text,
  latitude double precision,
  longitude double precision,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.visitor_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  visitor_id text,
  session_id text,
  lead_id uuid,
  campaign_id uuid,
  event_type text not null,
  url text,
  title text,
  user_agent text,
  city text,
  region text,
  country text,
  latitude double precision,
  longitude double precision,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.click_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  lead_id uuid,
  campaign_id uuid,
  email_id uuid,
  tracking_id text,
  destination_url text,
  user_agent text,
  ip_address inet,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_events_tenant_created_at
on public.admin_events (tenant_id, created_at desc);

create index if not exists idx_visitor_events_tenant_created_at
on public.visitor_events (tenant_id, created_at desc);

create index if not exists idx_visitor_sessions_tenant_last_seen
on public.visitor_sessions (tenant_id, last_seen_at desc);

create index if not exists idx_click_events_tenant_created_at
on public.click_events (tenant_id, created_at desc);

create index if not exists idx_click_events_campaign_created_at
on public.click_events (campaign_id, created_at desc);
