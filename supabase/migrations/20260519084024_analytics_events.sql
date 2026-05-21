-- First-party analytics for page visits, live users, and user flows.
-- Browser clients write through Edge Functions only; raw analytics rows are
-- not directly readable through the public Data API.

create table if not exists public.analytics_sessions (
  session_id text primary key,
  user_id uuid references auth.users (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_screen text,
  current_path text,
  referrer text,
  user_agent text,
  is_authenticated boolean not null default false,
  constraint analytics_sessions_session_id_len
    check (char_length(session_id) between 12 and 128)
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.analytics_sessions (session_id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  screen text,
  path text,
  referrer text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint analytics_events_event_type_fmt
    check (event_type ~ '^[a-z0-9_:-]{1,64}$'),
  constraint analytics_events_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_session_created_idx
  on public.analytics_events (session_id, created_at);

create index if not exists analytics_events_event_type_created_idx
  on public.analytics_events (event_type, created_at desc);

create index if not exists analytics_sessions_last_seen_idx
  on public.analytics_sessions (last_seen_at desc);

alter table public.analytics_sessions enable row level security;
alter table public.analytics_events enable row level security;

revoke all on public.analytics_sessions from anon, authenticated;
revoke all on public.analytics_events from anon, authenticated;
grant all on public.analytics_sessions to service_role;
grant all on public.analytics_events to service_role;

comment on table public.analytics_sessions is
  'First-party analytics session state used for live user counts.';
comment on table public.analytics_events is
  'First-party analytics events written by Edge Functions and reported in aggregate.';
