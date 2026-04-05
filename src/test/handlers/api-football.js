import { http, HttpResponse } from "msw";
import preFixtures from "../../lib/__fixtures__/api-football/fixtures-pre-tournament.json" assert { type: "json" };
import midFixtures from "../../lib/__fixtures__/api-football/fixtures-mid-tournament.json" assert { type: "json" };
import completeFixtures from "../../lib/__fixtures__/api-football/fixtures-complete.json" assert { type: "json" };
import standings from "../../lib/__fixtures__/api-football/standings.json" assert { type: "json" };
import topscorers from "../../lib/__fixtures__/api-football/topscorers.json" assert { type: "json" };
import events1001 from "../../lib/__fixtures__/api-football/events-fixture-1001.json" assert { type: "json" };

const BASE = "https://v3.football.api-sports.io";

// Default handlers serve pre-tournament data (no scores yet).
// Override per-test with server.use(...) for mid-tournament / complete scenarios.
export const apiFootballHandlers = [
  http.get(`${BASE}/fixtures`, () => HttpResponse.json(preFixtures)),
  http.get(`${BASE}/standings`, () => HttpResponse.json(standings)),
  http.get(`${BASE}/players/topscorers`, () => HttpResponse.json(topscorers)),
  http.get(`${BASE}/fixtures/events`, () => HttpResponse.json({ response: [] })),
];

/** Override helpers — import and spread inside server.use() in individual tests */
export const midTournamentHandlers = [
  http.get(`${BASE}/fixtures`, () => HttpResponse.json(midFixtures)),
  http.get(`${BASE}/standings`, () => HttpResponse.json(standings)),
  http.get(`${BASE}/players/topscorers`, () => HttpResponse.json(topscorers)),
  http.get(`${BASE}/fixtures/events`, ({ request }) => {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("fixture"));
    if (id === 1001) return HttpResponse.json(events1001);
    return HttpResponse.json({ response: [] });
  }),
];

export const completeTournamentHandlers = [
  http.get(`${BASE}/fixtures`, () => HttpResponse.json(completeFixtures)),
  http.get(`${BASE}/standings`, () => HttpResponse.json(standings)),
  http.get(`${BASE}/players/topscorers`, () => HttpResponse.json(topscorers)),
  http.get(`${BASE}/fixtures/events`, ({ request }) => {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("fixture"));
    if (id === 1001) return HttpResponse.json(events1001);
    return HttpResponse.json({ response: [] });
  }),
];
