-- ============================================================================
-- Deadline source of truth + prediction write policy repairs
-- ============================================================================
-- Adds a small public settings table for tournament dates, points entries_are_closed()
-- at that setting, and makes every prediction write policy enforce both the
-- entry deadline and profile locked state.
-- ============================================================================

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_public_read" on public.app_settings;
create policy "app_settings_public_read"
  on public.app_settings for select
  using (true);

drop policy if exists "app_settings_service_write" on public.app_settings;
create policy "app_settings_service_write"
  on public.app_settings for all
  using ((select current_setting('role', true)) = 'service_role')
  with check ((select current_setting('role', true)) = 'service_role');

grant select on public.app_settings to anon, authenticated;
grant all on public.app_settings to service_role;

insert into public.app_settings (key, value)
values
  ('entry_deadline_iso', '2026-06-11T21:00:00.000Z'),
  ('first_match_kickoff_iso', '2026-06-11T22:00:00.000Z')
on conflict (key) do nothing;

create or replace function public.entry_deadline_at()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select value::timestamptz from public.app_settings where key = 'entry_deadline_iso'),
    timestamptz '2026-06-11 21:00:00+00'
  );
$$;

create or replace function public.entries_are_closed()
returns boolean
language sql
stable
set search_path = public
as $$
  select now() >= public.entry_deadline_at();
$$;

comment on function public.entry_deadline_at() is
  'Tournament entry deadline used by RLS, checkout, and the frontend settings fetch.';
comment on function public.entries_are_closed() is
  'True once entries/prediction visibility should be closed/opened.';

revoke all on function public.entry_deadline_at() from public;
revoke all on function public.entries_are_closed() from public;
grant execute on function public.entry_deadline_at() to anon, authenticated, service_role;
grant execute on function public.entries_are_closed() to anon, authenticated, service_role;

-- Normalized prediction writes: owner only, before deadline only, unlocked only.
drop policy if exists "mp_insert_own" on public.match_predictions;
drop policy if exists "mp_update_own" on public.match_predictions;
drop policy if exists "mp_delete_own" on public.match_predictions;
create policy "mp_insert_own" on public.match_predictions for insert
  with check (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "mp_update_own" on public.match_predictions for update
  using (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  )
  with check (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "mp_delete_own" on public.match_predictions for delete
  using (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

drop policy if exists "sp_insert_own" on public.standings_predictions;
drop policy if exists "sp_update_own" on public.standings_predictions;
drop policy if exists "sp_delete_own" on public.standings_predictions;
create policy "sp_insert_own" on public.standings_predictions for insert
  with check (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "sp_update_own" on public.standings_predictions for update
  using (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  )
  with check (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "sp_delete_own" on public.standings_predictions for delete
  using (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

drop policy if exists "op_insert_own" on public.outright_predictions;
drop policy if exists "op_update_own" on public.outright_predictions;
drop policy if exists "op_delete_own" on public.outright_predictions;
create policy "op_insert_own" on public.outright_predictions for insert
  with check (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "op_update_own" on public.outright_predictions for update
  using (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  )
  with check (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "op_delete_own" on public.outright_predictions for delete
  using (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

drop policy if exists "statp_insert_own" on public.stat_predictions;
drop policy if exists "statp_update_own" on public.stat_predictions;
drop policy if exists "statp_delete_own" on public.stat_predictions;
create policy "statp_insert_own" on public.stat_predictions for insert
  with check (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "statp_update_own" on public.stat_predictions for update
  using (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  )
  with check (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "statp_delete_own" on public.stat_predictions for delete
  using (
    (select auth.uid()) = user_id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

-- Legacy JSON predictions use the same write rules.
drop policy if exists "wc_predictions_insert_own_unlocked" on public.wc_predictions;
drop policy if exists "wc_predictions_update_own_unlocked" on public.wc_predictions;
create policy "wc_predictions_insert_own_unlocked"
  on public.wc_predictions for insert
  with check (
    (select auth.uid()) = id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "wc_predictions_update_own_unlocked"
  on public.wc_predictions for update
  using (
    (select auth.uid()) = id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  )
  with check (
    (select auth.uid()) = id
    and not public.entries_are_closed()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
