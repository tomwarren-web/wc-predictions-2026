-- Payment should confirm the entry only. Prediction locking is deadline-owned.

create or replace function public.lock_predictions_on_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and (old.status is null or old.status <> 'completed') then
    update public.profiles
    set
      paid = true,
      updated_at = now()
    where id = new.user_id;
  end if;
  return new;
end;
$$;

comment on function public.lock_predictions_on_payment() is
  'Marks payment as received. Does not lock predictions; deadline sync owns the locked flag.';

revoke all on function public.lock_predictions_on_payment() from public, anon, authenticated;

create or replace function public.sync_prediction_locks_with_deadline()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer := 0;
  deadline_closed boolean := public.entries_are_closed();
begin
  update public.profiles
  set
    locked = deadline_closed,
    updated_at = now()
  where paid = true
    and locked is distinct from deadline_closed;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

comment on function public.sync_prediction_locks_with_deadline() is
  'Synchronizes paid profile locked flags with the entry deadline. Schedule or run after the deadline to lock predictions.';

revoke all on function public.sync_prediction_locks_with_deadline() from public, anon, authenticated;
grant execute on function public.sync_prediction_locks_with_deadline() to service_role;

-- Repair paid entries that were locked by payment before the deadline.
select public.sync_prediction_locks_with_deadline();
