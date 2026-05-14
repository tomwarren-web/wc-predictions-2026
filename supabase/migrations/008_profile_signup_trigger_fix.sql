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
