-- Run once in Supabase SQL Editor (or via supabase db push if you use CLI).
-- Enable Anonymous sign-ins: Authentication → Providers → Anonymous users.

create table if not exists public.wc_predictions (
  id uuid primary key references auth.users (id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  predictions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.wc_predictions enable row level security;

create policy "wc_predictions_select_own"
  on public.wc_predictions for select
  using (auth.uid() = id);

create policy "wc_predictions_insert_own"
  on public.wc_predictions for insert
  with check (auth.uid() = id);

create policy "wc_predictions_update_own"
  on public.wc_predictions for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Optional: let anyone read display_name / avatar for a future live leaderboard UI.
-- Uncomment if you add a public leaderboard that reads from this table.
-- create policy "wc_predictions_public_read_profiles"
--   on public.wc_predictions for select
--   using (true);
