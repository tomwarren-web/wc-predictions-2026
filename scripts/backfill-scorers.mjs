// One-off: backfill goalscorers for finished matches the data feed never populated.
//
// football-data.org returns these games as FINISHED with the correct score but an
// empty goals array, and the edge function marks them scorersFetched=true so they
// are never retried. We inject researched scorers straight into the results cache
// (app_settings -> football_results_cache_v2). The edge function's refresh path
// falls back to cached scorers whenever a fresh fetch returns none, so these persist.
//
// Format per the existing feed: array of "Team|Player" strings, ASCII (no accents),
// one entry per goal, team names normalized (matching GROUPS / TEAM_ALIAS output).
//
// Run:  SUPABASE_SERVICE_ROLE_KEY=<service-key> node scripts/backfill-scorers.mjs
//   (SUPABASE_URL defaults to VITE_SUPABASE_URL from your shell/.env.local)
//   Add --dry to preview without writing.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const CACHE_KEY = "football_results_cache_v2";

// Sources (2026 FIFA World Cup, group stage, 27 Jun 2026):
//  Panama 0-2 England  — Bellingham, Kane (Sky/FIFA)
//  Croatia 2-1 Ghana   — Sucic, Vlasic / Luckassen (FIFA/Sky/101GG)
//  DR Congo 3-1 Uzbekistan — Shomurodov / Wissa x2, Mayele (FIFA/101GG)
//  Jordan 1-3 Argentina — Al-Tamari / Lo Celso, L. Martinez, Messi (ESPN/Sky)
//  Algeria 3-3 Austria — Belghali, Mahrez x2 / Arnautovic, Sabitzer, Kalajdzic (FIFA/ESPN)
const SCORERS = {
  "Panama-England": [
    "England|Jude Bellingham",
    "England|Harry Kane",
  ],
  "Croatia-Ghana": [
    "Croatia|Petar Sucic",
    "Ghana|Derrick Luckassen",
    "Croatia|Nikola Vlasic",
  ],
  "DR Congo-Uzbekistan": [
    "Uzbekistan|Eldor Shomurodov",
    "DR Congo|Yoane Wissa",
    "DR Congo|Fiston Mayele",
    "DR Congo|Yoane Wissa",
  ],
  "Jordan-Argentina": [
    "Argentina|Giovani Lo Celso",
    "Argentina|Lautaro Martinez",
    "Jordan|Mousa Al-Tamari",
    "Argentina|Lionel Messi",
  ],
  "Algeria-Austria": [
    "Austria|Marko Arnautovic",
    "Algeria|Rafik Belghali",
    "Austria|Marcel Sabitzer",
    "Algeria|Riyad Mahrez",
    "Algeria|Riyad Mahrez",
    "Austria|Sasa Kalajdzic",
  ],
};

const dry = process.argv.includes("--dry");

function readEnvFromLocal(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : undefined;
  } catch {
    return undefined;
  }
}

const url = process.env.SUPABASE_URL || readEnvFromLocal("VITE_SUPABASE_URL");
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  readEnvFromLocal("SUPABASE_SERVICE_ROLE_KEY") ||
  readEnvFromLocal("SUPABASE_SECRET_KEY");

if (!url) throw new Error("Set SUPABASE_URL (or VITE_SUPABASE_URL in .env.local).");
if (!serviceKey) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY (service role key — required to write app_settings).");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from("app_settings")
  .select("value")
  .eq("key", CACHE_KEY)
  .maybeSingle();

if (error) throw new Error(`Read cache failed: ${error.message}`);
if (!data?.value) throw new Error(`Cache row "${CACHE_KEY}" not found or empty.`);

const results = JSON.parse(data.value);
const matches = results.matches || {};

let applied = 0;
for (const [key, scorers] of Object.entries(SCORERS)) {
  const m = matches[key];
  if (!m) { console.warn(`SKIP ${key}: not in cache`); continue; }

  // Validate the researched scorers match the recorded scoreline before touching anything.
  const home = scorers.filter((s) => s.startsWith(`${m.homeTeam}|`)).length;
  const away = scorers.filter((s) => s.startsWith(`${m.awayTeam}|`)).length;
  if (home !== m.homeGoals || away !== m.awayGoals) {
    console.warn(`SKIP ${key}: scorer count ${home}-${away} != scoreline ${m.homeGoals}-${m.awayGoals}`);
    continue;
  }
  if (Array.isArray(m.scorers) && m.scorers.length) {
    console.log(`NOTE ${key}: already had ${m.scorers.length} scorers — overwriting`);
  }

  m.scorers = scorers;
  m.scorersFetched = true;
  applied += 1;
  console.log(`OK   ${key}: ${m.homeTeam} ${m.homeGoals}-${m.awayGoals} ${m.awayTeam} -> ${scorers.join(", ")}`);
}

if (!applied) { console.log("Nothing to apply."); process.exit(0); }

if (dry) { console.log(`\nDRY RUN — ${applied} match(es) would be updated. No write performed.`); process.exit(0); }

const { error: writeErr } = await supabase
  .from("app_settings")
  .upsert({ key: CACHE_KEY, value: JSON.stringify(results), updated_at: new Date().toISOString() }, { onConflict: "key" });

if (writeErr) throw new Error(`Write cache failed: ${writeErr.message}`);
console.log(`\nDone — updated ${applied} match(es) in ${CACHE_KEY}.`);
