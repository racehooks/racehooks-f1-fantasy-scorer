import type { ScoringRules } from "./types";

/**
 * OfficialF1ScoringRules — the official **F1 Fantasy** game scoring system
 * (2025 / 2026 regulations).
 *
 * Sourced from the official rules (fantasy.formula1.com/en/game-rules) and
 * corroborated against the Motor Sport Magazine 2025 guide and community
 * trackers (f1fantasytools.com, GridRival, FanAmp). Every value below is
 * annotated with its origin so the table can be re-verified each season.
 *
 * ── Driver scoring ────────────────────────────────────────────────────────
 *  Qualifying (grid) points:  P1=10 … P10=1, P11+=0
 *  Race finish points:        P1=25, 18, 15, 12, 10, 8, 6, 4, 2, 1 (P11+=0)
 *  Sprint finish points:      P1=8, 7, 6, 5, 4, 3, 2, 1 (P9+=0)
 *  Positions gained:          +1 per place gained (start → finish, uncapped)
 *  Positions lost:            -1 per place lost
 *  Overtakes:                 +1 per legal on-track overtake (stacks with
 *                             positions-gained — the official game awards both)
 *  Driver of the Day:         +10
 *  Beat teammate (quali):     +2   (qualified ahead of teammate)
 *  Beat teammate (race):      +3   (finished ahead of teammate)
 *  Race DNF / not classified: -20
 *  Race disqualification:     -25
 *  Failed to set quali time / quali DSQ: -5
 *
 * ── 2026 changes baked in ─────────────────────────────────────────────────
 *  - Sprint DNF reduced from -20 to -10 (FanAmp / Into the Chicane, 2026).
 *  - Fastest-lap bonus remains REMOVED (dropped for 2025, still gone in 2026).
 *
 * ── Constructor scoring ───────────────────────────────────────────────────
 *  A constructor scores the combined total of its two drivers across
 *  qualifying + race, PLUS pit-stop performance:
 *    > 3.00s : 0
 *    2.50–2.99s : +2
 *    2.20–2.49s : +5
 *    2.00–2.19s : +10
 *    < 2.00s : +20
 *  +5 to the team with the fastest stop of the race.
 *  +15 to any team that sets a new pit-stop world record (< 1.80s).
 *
 * Index 0 of every position table is a sentinel (-Infinity placeholder is
 * avoided; 0 is used) so that `table[position]` reads naturally for P1..Pn.
 */
export const OfficialF1ScoringRules: ScoringRules = {
  name: "Official F1 Fantasy (2026)",

  // index 0 unused; P1..P10 then zeros. Standard F1 championship points.
  racePositionPoints: [0, 25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  // Standard F1 sprint points, P1..P8.
  sprintPositionPoints: [0, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  // Pole = 10, linear down to P10 = 1.
  qualifyingPositionPoints: [0, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  positionGainedPoints: 1,
  positionLostPoints: -1,
  overtakePoints: 1,

  // Fastest lap bonus intentionally omitted (removed from the official game in 2025).
  driverOfTheDayPoints: 10,
  beatTeammateQualifyingPoints: 2,
  beatTeammateRacePoints: 3,

  raceDnfPoints: -20,
  sprintDnfPoints: -10, // 2026: reduced from -20
  raceDisqualificationPoints: -25,
  qualifyingDisqualificationPoints: -5,

  pitStopBands: [
    { minMs: 0, maxMs: 2000, points: 20 },
    { minMs: 2000, maxMs: 2200, points: 10 },
    { minMs: 2200, maxMs: 2500, points: 5 },
    { minMs: 2500, maxMs: 3000, points: 2 },
    { minMs: 3000, maxMs: Number.POSITIVE_INFINITY, points: 0 },
  ],
  fastestPitStopBonus: 5,
  pitStopWorldRecordBonus: 15,
  pitStopWorldRecordMs: 1800,

  defaultBoostMultiplier: 2,
};
