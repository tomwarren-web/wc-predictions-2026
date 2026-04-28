-- ============================================================================
-- Security and UX hardening
-- ============================================================================
-- Keeps payment/lock state server-owned, hides competitors' picks until entries
-- close, and addresses Supabase advisor warnings for function search paths and
-- executable SECURITY DEFINER functions.
-- ============================================================================

-- 1. Shared deadline helper ---------------------------------------------------
-- Keep this in sync with VITE_FIRST_MATCH_KICKOFF_ISO / fallback tournament date.
create or replace function public.entries_are_closed()
returns boolean
language sql
stable
set search_path = public
as $$
  select now() >= timestamptz '2026-06-11 21:00:00+00';
$$;

comment on function public.entries_are_closed() is
  'True once entries/prediction visibility should be closed/opened (one hour before first kickoff).';

-- 2. Keep profile payment fields server-owned --------------------------------
create or replace function public.protect_profile_server_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.paid is distinct from false
      or new.locked is distinct from false
      or new.stripe_customer_id is not null
    then
      raise exception 'paid, locked, and stripe_customer_id are server-managed fields'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.paid is distinct from old.paid
      or new.locked is distinct from old.locked
      or new.stripe_customer_id is distinct from old.stripe_customer_id
    then
      raise exception 'paid, locked, and stripe_customer_id are server-managed fields'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_server_fields on public.profiles;
create trigger protect_profile_server_fields
  before insert or update on public.profiles
  for each row execute function public.protect_profile_server_fields();

-- Existing legacy rows may contain email mirrors in public JSON.
update public.wc_predictions
set profile = profile - 'email'
where profile ? 'email';

-- 3. Profiles: own reads/writes only; no broad public profile table access ----
drop policy if exists "profiles_public_read" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select
  using ((select auth.uid()) = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 4. Prediction visibility: own picks always, all picks after entry deadline ---
drop policy if exists "mp_select_all" on public.match_predictions;
drop policy if exists "sp_select_all" on public.standings_predictions;
drop policy if exists "op_select_all" on public.outright_predictions;
drop policy if exists "statp_select_all" on public.stat_predictions;

create policy "mp_select_own_or_closed"
  on public.match_predictions for select
  using (public.entries_are_closed() or (select auth.uid()) = user_id);

create policy "sp_select_own_or_closed"
  on public.standings_predictions for select
  using (public.entries_are_closed() or (select auth.uid()) = user_id);

create policy "op_select_own_or_closed"
  on public.outright_predictions for select
  using (public.entries_are_closed() or (select auth.uid()) = user_id);

create policy "statp_select_own_or_closed"
  on public.stat_predictions for select
  using (public.entries_are_closed() or (select auth.uid()) = user_id);

-- Recreate write/delete policies with initplan-friendly auth.uid() calls.
drop policy if exists "mp_insert_own" on public.match_predictions;
drop policy if exists "mp_update_own" on public.match_predictions;
drop policy if exists "mp_delete_own" on public.match_predictions;
create policy "mp_insert_own" on public.match_predictions for insert
  with check ((select auth.uid()) = user_id);
create policy "mp_update_own" on public.match_predictions for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "mp_delete_own" on public.match_predictions for delete
  using (
    (select auth.uid()) = user_id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

drop policy if exists "sp_insert_own" on public.standings_predictions;
drop policy if exists "sp_update_own" on public.standings_predictions;
drop policy if exists "sp_delete_own" on public.standings_predictions;
create policy "sp_insert_own" on public.standings_predictions for insert
  with check ((select auth.uid()) = user_id);
create policy "sp_update_own" on public.standings_predictions for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "sp_delete_own" on public.standings_predictions for delete
  using (
    (select auth.uid()) = user_id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

drop policy if exists "op_insert_own" on public.outright_predictions;
drop policy if exists "op_update_own" on public.outright_predictions;
drop policy if exists "op_delete_own" on public.outright_predictions;
create policy "op_insert_own" on public.outright_predictions for insert
  with check ((select auth.uid()) = user_id);
create policy "op_update_own" on public.outright_predictions for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "op_delete_own" on public.outright_predictions for delete
  using (
    (select auth.uid()) = user_id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

drop policy if exists "statp_insert_own" on public.stat_predictions;
drop policy if exists "statp_update_own" on public.stat_predictions;
drop policy if exists "statp_delete_own" on public.stat_predictions;
create policy "statp_insert_own" on public.stat_predictions for insert
  with check ((select auth.uid()) = user_id);
create policy "statp_update_own" on public.stat_predictions for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );
create policy "statp_delete_own" on public.stat_predictions for delete
  using (
    (select auth.uid()) = user_id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

-- 5. Legacy JSON predictions: hide competitors before deadline and block lock drift.
drop policy if exists "wc_predictions_public_read" on public.wc_predictions;
drop policy if exists "wc_predictions_insert_own" on public.wc_predictions;
drop policy if exists "wc_predictions_update_own" on public.wc_predictions;
drop policy if exists "wc_predictions_select_own" on public.wc_predictions;

create policy "wc_predictions_select_own_or_closed"
  on public.wc_predictions for select
  using (public.entries_are_closed() or (select auth.uid()) = id);

create policy "wc_predictions_insert_own_unlocked"
  on public.wc_predictions for insert
  with check (
    (select auth.uid()) = id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

create policy "wc_predictions_update_own_unlocked"
  on public.wc_predictions for update
  using (
    (select auth.uid()) = id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  )
  with check (
    (select auth.uid()) = id
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.locked)
  );

-- 6. Other RLS initplan cleanups ---------------------------------------------
drop policy if exists "pay_select_own" on public.payments;
create policy "pay_select_own" on public.payments for select
  using ((select auth.uid()) = user_id);

drop policy if exists "pay_service_insert" on public.payments;
drop policy if exists "pay_service_update" on public.payments;
create policy "pay_service_insert" on public.payments for insert
  with check ((select current_setting('role', true)) = 'service_role');
create policy "pay_service_update" on public.payments for update
  using ((select current_setting('role', true)) = 'service_role');

drop policy if exists "results_service_write" on public.match_results;
create policy "results_service_write" on public.match_results for all
  using ((select current_setting('role', true)) = 'service_role')
  with check ((select current_setting('role', true)) = 'service_role');

drop policy if exists "tr_service_write" on public.tournament_results;
create policy "tr_service_write" on public.tournament_results for all
  using ((select current_setting('role', true)) = 'service_role')
  with check ((select current_setting('role', true)) = 'service_role');

drop policy if exists "lb_service_write" on public.leaderboard;
create policy "lb_service_write" on public.leaderboard for all
  using ((select current_setting('role', true)) = 'service_role')
  with check ((select current_setting('role', true)) = 'service_role');

drop policy if exists "email_select_own" on public.email_log;
drop policy if exists "email_service_write" on public.email_log;
create policy "email_select_own" on public.email_log for select
  using ((select auth.uid()) = user_id);
create policy "email_service_write" on public.email_log for insert
  with check ((select current_setting('role', true)) = 'service_role');

-- 7. Harden functions and view definitions -----------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.lock_predictions_on_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and (old.status is null or old.status <> 'completed') then
    update public.profiles set paid = true, locked = true, updated_at = now()
    where id = new.user_id;
  end if;
  return new;
end;
$$;

create or replace function public.migrate_legacy_predictions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  pred jsonb;
  k text;
  v jsonb;
begin
  for rec in select id, profile, predictions from public.wc_predictions loop
    insert into public.profiles (id, email, name, username)
    values (
      rec.id,
      coalesce(rec.profile->>'email', 'unknown@example.com'),
      coalesce(rec.profile->>'name', 'Unknown'),
      coalesce(rec.profile->>'username', 'user_' || left(rec.id::text, 8))
    )
    on conflict (id) do update set
      email = excluded.email,
      name = excluded.name,
      updated_at = now();

    pred := rec.predictions;
    if pred is null then continue; end if;

    for k, v in select * from jsonb_each(pred)
    where key like '%-%' and key not like 'standings_%'
    loop
      insert into public.match_predictions (user_id, match_key, home_goals, away_goals, scorer)
      values (rec.id, k, (v->>'home')::smallint, (v->>'away')::smallint, v->>'scorer')
      on conflict (user_id, match_key) do update set
        home_goals = excluded.home_goals,
        away_goals = excluded.away_goals,
        scorer = excluded.scorer;
    end loop;

    for k, v in select * from jsonb_each(pred) where key like 'standings_%' loop
      insert into public.standings_predictions (user_id, group_letter, position_1, position_2, position_3, position_4)
      values (rec.id, right(k, 1), v->>0, v->>1, v->>2, v->>3)
      on conflict (user_id, group_letter) do update set
        position_1 = excluded.position_1,
        position_2 = excluded.position_2,
        position_3 = excluded.position_3,
        position_4 = excluded.position_4;
    end loop;

    for k in select unnest(array['winner','runner_up','third','golden_boot','golden_glove','best_young','top_scoring_team','england_progress','total_goals']) loop
      if pred->>k is not null and pred->>k <> '' then
        insert into public.outright_predictions (user_id, prediction_type, value)
        values (rec.id, k, pred->>k)
        on conflict (user_id, prediction_type) do update set value = excluded.value;
      end if;
    end loop;

    for k in select unnest(array['total_goals']) loop
      if pred->>k is not null and pred->>k <> '' then
        insert into public.stat_predictions (user_id, stat_key, value)
        values (rec.id, k, pred->>k::text)
        on conflict (user_id, stat_key) do update set value = excluded.value;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace view public.leaderboard_view
with (security_invoker = true)
as
select
  l.*,
  p.name,
  p.username,
  p.paid
from public.leaderboard l
join public.profiles p on p.id = l.user_id
where p.paid = true
order by l.total_points desc, abs(coalesce(l.total_goals_pred, 0) - coalesce(
  (select value::integer from public.tournament_results where key = 'total_goals'), 0
)) asc;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.lock_predictions_on_payment() from public, anon, authenticated;
revoke all on function public.migrate_legacy_predictions() from public, anon, authenticated;
revoke all on function public.protect_profile_server_fields() from public, anon, authenticated;
