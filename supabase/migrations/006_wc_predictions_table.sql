-- ============================================================================
-- Legacy wc_predictions table (JSON blob + leaderboard source)
-- ============================================================================
-- Migration 003 creates profiles + normalized prediction tables but does NOT
-- create wc_predictions (it assumes 001_initial.sql ran first). If you only
-- ran 003, PostgREST returns PGRST205 "Could not find the table public.wc_predictions".
-- Run this migration to add the table and RLS policies.
-- ============================================================================

create table if not exists public.wc_predictions (
  id uuid primary key references auth.users (id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  predictions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.wc_predictions enable row level security;

-- Leaderboard: all rows readable (display names + prediction JSON client-side)
drop policy if exists "wc_predictions_public_read" on public.wc_predictions;
create policy "wc_predictions_public_read"
  on public.wc_predictions for select
  using (true);

drop policy if exists "wc_predictions_insert_own" on public.wc_predictions;
create policy "wc_predictions_insert_own"
  on public.wc_predictions for insert
  with check (auth.uid() = id);

drop policy if exists "wc_predictions_update_own" on public.wc_predictions;
create policy "wc_predictions_update_own"
  on public.wc_predictions for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Per-user select is superseded by public read (same as 002_leaderboard.sql)
drop policy if exists "wc_predictions_select_own" on public.wc_predictions;
