-- Payment confirms entry, but predictions stay editable until the entry deadline.
-- The app and RLS policies use public.entries_are_closed() as the deadline lock.

create or replace function public.lock_predictions_on_payment()
returns trigger as $$
begin
  if new.status = 'completed' and (old.status is null or old.status <> 'completed') then
    update public.profiles
    set
      paid = true,
      locked = public.entries_are_closed(),
      updated_at = now()
    where id = new.user_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Repair any already-paid entries that were locked by payment before the deadline.
update public.profiles
set locked = false, updated_at = now()
where paid = true
  and locked = true
  and not public.entries_are_closed();

-- If this migration is ever applied after entries close, keep paid entries locked.
update public.profiles
set locked = true, updated_at = now()
where paid = true
  and locked = false
  and public.entries_are_closed();

comment on function public.lock_predictions_on_payment() is
  'Marks payment as received. Predictions only become locked once entries_are_closed() is true.';

revoke all on function public.lock_predictions_on_payment() from public, anon, authenticated;
