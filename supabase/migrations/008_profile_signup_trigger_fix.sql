-- ============================================================================
-- Profile signup trigger fix
-- ============================================================================
-- Migration 007 revoked public execution on SECURITY DEFINER functions, which is
-- right for API safety, but Supabase Auth needs to execute handle_new_user() from
-- the internal auth role when auth.users rows are created.
-- ============================================================================

grant execute on function public.handle_new_user() to supabase_auth_admin;

create or replace function public.protect_profile_server_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor text := coalesce(current_setting('role', true), current_user);
begin
  -- Service and Supabase-owned internal roles are allowed to manage payment state.
  if actor in ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin')
    or current_user in ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin')
  then
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

revoke all on function public.protect_profile_server_fields() from public, anon, authenticated;

-- Backfill any auth users created while the trigger permission was too strict.
-- Usernames are deduped here because profiles_username_idx is already unique,
-- and migration 009 cannot repair this if migration 008 fails first.
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
