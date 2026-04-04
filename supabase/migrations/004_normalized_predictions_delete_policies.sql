-- Allow users to clear and replace normalized prediction rows when saving (same lock rules as update).

create policy "mp_delete_own"
  on public.match_predictions for delete
  using (
    auth.uid() = user_id
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.locked)
  );

create policy "sp_delete_own"
  on public.standings_predictions for delete
  using (
    auth.uid() = user_id
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.locked)
  );

create policy "op_delete_own"
  on public.outright_predictions for delete
  using (
    auth.uid() = user_id
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.locked)
  );

create policy "statp_delete_own"
  on public.stat_predictions for delete
  using (
    auth.uid() = user_id
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.locked)
  );
