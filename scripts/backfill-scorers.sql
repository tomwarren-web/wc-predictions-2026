-- Backfill goalscorers for 5 finished matches the data feed never populated.
-- Run in: Supabase Dashboard -> SQL Editor (runs as a privileged role; app_settings
-- writes are restricted to service_role by RLS).
--
-- The cache value is a TEXT column holding JSON, so we cast to jsonb, patch each
-- match's scorers, and cast back to text. scorers format = ["Team|Player", ...],
-- one entry per goal, ASCII names, normalized team names — matching the live feed.
-- The edge function's refresh path falls back to cached scorers when a fresh fetch
-- returns none, so these persist.

update public.app_settings
set value = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      value::jsonb,
      '{matches,"Panama-England",scorers}',
      '["England|Jude Bellingham","England|Harry Kane"]'::jsonb),
      '{matches,"Croatia-Ghana",scorers}',
      '["Croatia|Petar Sucic","Ghana|Derrick Luckassen","Croatia|Nikola Vlasic"]'::jsonb),
      '{matches,"DR Congo-Uzbekistan",scorers}',
      '["Uzbekistan|Eldor Shomurodov","DR Congo|Yoane Wissa","DR Congo|Fiston Mayele","DR Congo|Yoane Wissa"]'::jsonb),
      '{matches,"Jordan-Argentina",scorers}',
      '["Argentina|Giovani Lo Celso","Argentina|Lautaro Martinez","Jordan|Mousa Al-Tamari","Argentina|Lionel Messi"]'::jsonb),
      '{matches,"Algeria-Austria",scorers}',
      '["Austria|Marko Arnautovic","Algeria|Rafik Belghali","Austria|Marcel Sabitzer","Algeria|Riyad Mahrez","Algeria|Riyad Mahrez","Austria|Sasa Kalajdzic"]'::jsonb)::text,
    updated_at = now()
where key = 'football_results_cache_v2';

-- Verify:
select
  m.key as match,
  (value::jsonb #> array['matches', m.key, 'scorers']) as scorers
from public.app_settings,
     unnest(array['Panama-England','Croatia-Ghana','DR Congo-Uzbekistan','Jordan-Argentina','Algeria-Austria']) as m(key)
where app_settings.key = 'football_results_cache_v2';
