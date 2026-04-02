-- Enable public read access to wc_predictions for the live leaderboard.
-- All authenticated users (including anonymous) can read everyone's predictions
-- to compute and display the leaderboard client-side.

create policy "wc_predictions_public_read"
  on public.wc_predictions for select
  using (true);

-- Drop the old per-user select policy since the public read supersedes it.
drop policy if exists "wc_predictions_select_own" on public.wc_predictions;
