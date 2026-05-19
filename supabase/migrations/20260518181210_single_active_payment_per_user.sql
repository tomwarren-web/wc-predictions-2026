-- Keep one active entry payment per user.
-- The Edge Function reuses open Checkout Sessions, and this index closes the
-- race where two requests try to create a pending payment at the same time.

with ranked_active_payments as (
  select
    id,
    status,
    row_number() over (
      partition by user_id
      order by
        case when status = 'completed' then 0 else 1 end,
        created_at desc
    ) as active_rank
  from public.payments
  where status in ('pending', 'completed')
)
update public.payments p
set status = 'expired'
from ranked_active_payments r
where p.id = r.id
  and r.active_rank > 1
  and p.status = 'pending';

create unique index if not exists payments_one_active_entry_per_user_idx
  on public.payments (user_id)
  where status in ('pending', 'completed');
