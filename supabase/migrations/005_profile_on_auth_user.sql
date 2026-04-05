-- ============================================================================
-- Auto-create public.profiles when a row is inserted into auth.users
-- ============================================================================
-- Sign-up can succeed in auth before the browser receives a session (e.g. email
-- confirmation required). The app then never runs upsertProfile on sign-up, so
-- users existed without profiles. This trigger keeps auth and profiles in sync.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
  v_username text;
begin
  v_email := coalesce(new.email, '');
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'Player'
  );
  v_username := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    'user_' || left(replace(new.id::text, '-', ''), 8)
  );

  insert into public.profiles (id, email, name, username, paid, locked)
  values (new.id, v_email, v_name, v_username, false, false)
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Ensures each auth.users row has a matching public.profiles row (Supabase trigger).';

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill: auth users created before this migration (idempotent)
insert into public.profiles (id, email, name, username, paid, locked)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Player'
  ),
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'username'), ''),
    'user_' || left(replace(u.id::text, '-', ''), 8)
  ),
  false,
  false
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
