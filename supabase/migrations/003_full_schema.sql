-- ============================================================================
-- WC Predictions 2026 — Full Database Schema
-- Run in Supabase SQL Editor (or via supabase db push).
-- This replaces the earlier single-table approach with a complete schema.
-- ============================================================================

-- 1. PROFILES ----------------------------------------------------------------
-- Extends auth.users with app-specific fields.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  name          text not null,
  username      text not null,
  avatar_url    text,
  paid          boolean not null default false,
  locked        boolean not null default false,
  stripe_customer_id text,
  email_notifications boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists profiles_username_idx on public.profiles (lower(username));
create index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.profiles enable row level security;

create policy "profiles_select_own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own"   on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own"   on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
-- Public read for leaderboard display names
create policy "profiles_public_read"  on public.profiles for select using (true);

-- 2. MATCH PREDICTIONS -------------------------------------------------------
create table if not exists public.match_predictions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  match_key   text not null,              -- "Mexico-South Africa"
  home_goals  smallint,
  away_goals  smallint,
  scorer      text,                       -- "Team|Player"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, match_key)
);

create index if not exists match_preds_user_idx on public.match_predictions (user_id);

alter table public.match_predictions enable row level security;

create policy "mp_select_all"  on public.match_predictions for select using (true);
create policy "mp_insert_own"  on public.match_predictions for insert with check (auth.uid() = user_id);
create policy "mp_update_own"  on public.match_predictions for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.locked)
  );

-- 3. STANDINGS PREDICTIONS ---------------------------------------------------
create table if not exists public.standings_predictions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  group_letter  char(1) not null,
  position_1    text,                     -- team finishing 1st
  position_2    text,
  position_3    text,
  position_4    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, group_letter)
);

alter table public.standings_predictions enable row level security;

create policy "sp_select_all"  on public.standings_predictions for select using (true);
create policy "sp_insert_own"  on public.standings_predictions for insert with check (auth.uid() = user_id);
create policy "sp_update_own"  on public.standings_predictions for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.locked)
  );

-- 4. OUTRIGHT PREDICTIONS ----------------------------------------------------
create table if not exists public.outright_predictions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  prediction_type  text not null,         -- winner, runner_up, third, golden_boot, etc.
  value            text not null,         -- team name or "Team|Player"
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, prediction_type)
);

alter table public.outright_predictions enable row level security;

create policy "op_select_all"  on public.outright_predictions for select using (true);
create policy "op_insert_own"  on public.outright_predictions for insert with check (auth.uid() = user_id);
create policy "op_update_own"  on public.outright_predictions for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.locked)
  );

-- 5. STAT PREDICTIONS --------------------------------------------------------
create table if not exists public.stat_predictions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  stat_key    text not null,              -- total_goals, red_cards, hat_tricks …
  value       text not null,              -- number or team name
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, stat_key)
);

alter table public.stat_predictions enable row level security;

create policy "statp_select_all"  on public.stat_predictions for select using (true);
create policy "statp_insert_own"  on public.stat_predictions for insert with check (auth.uid() = user_id);
create policy "statp_update_own"  on public.stat_predictions for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.locked)
  );

-- 6. PAYMENTS ----------------------------------------------------------------
create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  amount_pence             integer not null default 1000,
  currency                 text not null default 'gbp',
  status                   text not null default 'pending'
    check (status in ('pending','completed','failed','refunded','expired')),
  created_at               timestamptz not null default now(),
  completed_at             timestamptz
);

create index if not exists payments_user_idx   on public.payments (user_id);
create index if not exists payments_session_idx on public.payments (stripe_checkout_session_id);

alter table public.payments enable row level security;

create policy "pay_select_own" on public.payments for select using (auth.uid() = user_id);
-- Only server (service_role) can insert/update payments
create policy "pay_service_insert" on public.payments for insert with check (
  current_setting('role') = 'service_role'
);
create policy "pay_service_update" on public.payments for update using (
  current_setting('role') = 'service_role'
);

-- 7. MATCH RESULTS (from API-Football) ---------------------------------------
create table if not exists public.match_results (
  id              uuid primary key default gen_random_uuid(),
  match_key       text unique not null,   -- "Mexico-South Africa"
  home_team       text not null,
  away_team       text not null,
  home_goals      smallint,
  away_goals      smallint,
  status          text not null default 'scheduled'
    check (status in ('scheduled','live','finished')),
  minute          smallint,
  scorers         jsonb not null default '[]'::jsonb,
  round           text,
  fixture_date    timestamptz,
  api_fixture_id  integer,
  updated_at      timestamptz not null default now()
);

create index if not exists results_status_idx on public.match_results (status);

alter table public.match_results enable row level security;

create policy "results_public_read" on public.match_results for select using (true);
create policy "results_service_write" on public.match_results for all using (
  current_setting('role') = 'service_role'
);

-- 8. TOURNAMENT RESULTS (outrights, standings, stats) ------------------------
create table if not exists public.tournament_results (
  key    text primary key,                -- 'winner', 'standings_A', 'top_scoring_team' …
  value  text not null,
  meta   jsonb default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tournament_results enable row level security;

create policy "tr_public_read"   on public.tournament_results for select using (true);
create policy "tr_service_write" on public.tournament_results for all using (
  current_setting('role') = 'service_role'
);

-- 9. LEADERBOARD (computed scores) -------------------------------------------
create table if not exists public.leaderboard (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  total_points         integer not null default 0,
  match_points         integer not null default 0,
  standings_points     integer not null default 0,
  outright_points      integer not null default 0,
  stats_points         integer not null default 0,
  total_goals_pred     integer,
  rank                 integer,
  updated_at           timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

create policy "lb_public_read"   on public.leaderboard for select using (true);
create policy "lb_service_write" on public.leaderboard for all using (
  current_setting('role') = 'service_role'
);

-- 10. EMAIL LOG --------------------------------------------------------------
create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  email_to    text not null,
  email_type  text not null
    check (email_type in (
      'welcome','payment_confirmation','predictions_locked',
      'matchday_recap','weekly_standings','tournament_complete','custom'
    )),
  subject     text not null,
  resend_id   text,
  status      text not null default 'sent'
    check (status in ('sent','failed','bounced')),
  sent_at     timestamptz not null default now()
);

create index if not exists email_log_user_idx on public.email_log (user_id);
create index if not exists email_log_type_idx on public.email_log (email_type);

alter table public.email_log enable row level security;

create policy "email_select_own"    on public.email_log for select using (auth.uid() = user_id);
create policy "email_service_write" on public.email_log for insert with check (
  current_setting('role') = 'service_role'
);

-- 11. HELPER FUNCTIONS -------------------------------------------------------

-- Auto-update updated_at on row change
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger match_preds_updated_at before update on public.match_predictions
  for each row execute function public.set_updated_at();
create trigger standings_preds_updated_at before update on public.standings_predictions
  for each row execute function public.set_updated_at();
create trigger outright_preds_updated_at before update on public.outright_predictions
  for each row execute function public.set_updated_at();
create trigger stat_preds_updated_at before update on public.stat_predictions
  for each row execute function public.set_updated_at();

-- Lock predictions after successful payment
create or replace function public.lock_predictions_on_payment()
returns trigger as $$
begin
  if new.status = 'completed' and (old.status is null or old.status <> 'completed') then
    update public.profiles set paid = true, locked = true, updated_at = now()
    where id = new.user_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger payment_completed_lock
  after insert or update on public.payments
  for each row execute function public.lock_predictions_on_payment();

-- Leaderboard view joining profiles for display
create or replace view public.leaderboard_view as
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

-- 12. BACKWARD COMPATIBILITY ------------------------------------------------
-- The legacy wc_predictions table is left intact.
-- New code should use the normalised tables above.
-- A migration helper can be run once to copy data across:

create or replace function public.migrate_legacy_predictions()
returns void as $$
declare
  rec record;
  pred jsonb;
  k text;
  v jsonb;
begin
  for rec in select id, profile, predictions from public.wc_predictions loop
    -- Upsert profile
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

    -- Match predictions
    for k, v in select * from jsonb_each(pred)
    where key like '%-%' and key not like 'standings_%'
    loop
      insert into public.match_predictions (user_id, match_key, home_goals, away_goals, scorer)
      values (
        rec.id, k,
        (v->>'home')::smallint,
        (v->>'away')::smallint,
        v->>'scorer'
      )
      on conflict (user_id, match_key) do update set
        home_goals = excluded.home_goals,
        away_goals = excluded.away_goals,
        scorer = excluded.scorer;
    end loop;

    -- Standings predictions
    for k, v in select * from jsonb_each(pred) where key like 'standings_%' loop
      insert into public.standings_predictions (user_id, group_letter, position_1, position_2, position_3, position_4)
      values (
        rec.id,
        right(k, 1),
        v->>0, v->>1, v->>2, v->>3
      )
      on conflict (user_id, group_letter) do update set
        position_1 = excluded.position_1,
        position_2 = excluded.position_2,
        position_3 = excluded.position_3,
        position_4 = excluded.position_4;
    end loop;

    -- Outrights
    for k in select unnest(array['winner','runner_up','third','golden_boot','golden_glove','best_young','top_scoring_team','england_progress','total_goals']) loop
      if pred->>k is not null and pred->>k <> '' then
        insert into public.outright_predictions (user_id, prediction_type, value)
        values (rec.id, k, pred->>k)
        on conflict (user_id, prediction_type) do update set value = excluded.value;
      end if;
    end loop;

    -- Stats
    for k in select unnest(array['total_goals']) loop
      if pred->>k is not null and pred->>k <> '' then
        insert into public.stat_predictions (user_id, stat_key, value)
        values (rec.id, k, pred->>k::text)
        on conflict (user_id, stat_key) do update set value = excluded.value;
      end if;
    end loop;
  end loop;
end;
$$ language plpgsql security definer;

-- To migrate: select public.migrate_legacy_predictions();
