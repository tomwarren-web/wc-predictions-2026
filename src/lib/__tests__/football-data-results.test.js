import { describe, expect, it } from "vitest";
import { parseFootballDataScorers } from "../../../supabase/functions/football-results/football-data.ts";

describe("parseFootballDataScorers", () => {
  it("maps unfolded football-data.org goals to Team|Player scorer strings", () => {
    const scorers = parseFootballDataScorers({
      goals: [
        {
          type: "REGULAR",
          team: { name: "Mexico" },
          scorer: { name: "Santiago Gimenez" },
        },
      ],
    });

    expect(scorers).toEqual(["Mexico|Santiago Gimenez"]);
  });

  it("includes regular-time penalties but excludes own goals", () => {
    const scorers = parseFootballDataScorers({
      goals: [
        {
          type: "PENALTY",
          team: { name: "England" },
          scorer: { name: "Harry Kane" },
        },
        {
          type: "OWN",
          team: { name: "England" },
          scorer: { name: "Harry Kane" },
        },
      ],
    });

    expect(scorers).toEqual(["England|Harry Kane"]);
  });

  it("ignores penalty shootout entries outside the goals array", () => {
    const scorers = parseFootballDataScorers({
      goals: [],
      penalties: [
        {
          player: { name: "Harry Kane" },
          team: { name: "England" },
          scored: true,
        },
      ],
    });

    expect(scorers).toEqual([]);
  });

  it("normalizes team names before building scorer keys", () => {
    const scorers = parseFootballDataScorers(
      {
        goals: [
          {
            type: "REGULAR",
            team: { name: "United States of America" },
            scorer: { name: "Christian Pulisic" },
          },
        ],
      },
      (team) => (team === "United States of America" ? "USA" : team),
    );

    expect(scorers).toEqual(["USA|Christian Pulisic"]);
  });
});
