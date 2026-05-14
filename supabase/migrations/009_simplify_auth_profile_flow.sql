-- ============================================================================
-- Simplify auth/profile creation
-- ============================================================================
-- Supabase Auth owns credentials in auth.users. The app profile is derived once
-- by this trigger in public.profiles; browser code should only update editable
-- profile fields or repair legacy rows that pre-date the trigger.
--
-- This version also prevents duplicate display usernames from breaking sign-up.
-- If the requested username is taken, the trigger appends a stable user-id suffix.
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
  v_base_username text;
  v_username text;
  v_suffix text;
  v_counter integer := 0;
begin
  v_email := coalesce(new.email, '');
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'Player'
  );

  v_base_username := lower(coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'player'
  ));
  v_base_username := regexp_replace(v_base_username, '[^a-z0-9_]+', '_', 'g');
  v_base_username := regexp_replace(v_base_username, '_+', '_', 'g');
  v_base_username := trim(both '_' from v_base_username);
  if v_base_username = '' then
    v_base_username := 'player';
  end if;

  v_suffix := '_' || left(replace(new.id::text, '-', ''), 8);

  loop
    if v_counter = 0 then
      v_username := left(v_base_username, 24);
    elsif v_counter = 1 then
      v_username := left(v_base_username, 24) || v_suffix;
    else
      v_username := left(v_base_username, 24) || v_suffix || '_' || (v_counter - 1)::text;
    end if;

    if exists (
      select 1
      from public.profiles p
      where lower(p.username) = lower(v_username)
        and p.id <> new.id
    ) then
      v_counter := v_counter + 1;
      continue;
    end if;

    begin
      insert into public.profiles (id, email, name, username, paid, locked)
      values (new.id, v_email, v_name, v_username, false, false)
      on conflict (id) do update set
        email = excluded.email,
        name = excluded.name,
        username = coalesce(nullif(public.profiles.username, ''), excluded.username);

      return new;
    exception
      when unique_violation then
        v_counter := v_counter + 1;
    end;
  end loop;
end;
$$;

comment on function public.handle_new_user() is
  'Creates one public.profiles row for each auth.users row; usernames are made unique without failing signup.';

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Backfill auth users that still do not have a profile. The username candidate
-- is made unique against both existing profiles and other rows in this backfill.
with missing as (
  select
    u.id,
    coalesce(u.email, '') as email,
    coalesce(
      nullif(trim(u.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'Player'
    ) as name,
    coalesce(
      nullif(
        trim(both '_' from regexp_replace(
          regexp_replace(
            lower(coalesce(
              nullif(trim(u.raw_user_meta_data->>'username'), ''),
              nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
              'player'
            )),
            '[^a-z0-9_]+',
            '_',
            'g'
          ),
          '_+',
          '_',
          'g'
        )),
        ''
      ),
      'player'
    ) as username_base
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
),
ranked as (
  select
    m.*,
    row_number() over (partition by lower(m.username_base) order by m.id) as duplicate_rank
  from missing m
),
prepared as (
  select
    r.id,
    r.email,
    r.name,
    case
      when r.duplicate_rank > 1
        or exists (select 1 from public.profiles p where lower(p.username) = lower(left(r.username_base, 24)))
      then left(r.username_base, 24) || '_' || left(replace(r.id::text, '-', ''), 8)
      else left(r.username_base, 24)
    end as username
  from ranked r
)
insert into public.profiles (id, email, name, username, paid, locked)
select id, email, name, username, false, false
from prepared
on conflict do nothing;
