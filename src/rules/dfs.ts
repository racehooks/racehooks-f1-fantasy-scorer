import type { ScoringRules } from "./types";

/**
 * DFSScoringRules — a DraftKings-style Daily Fantasy Sports variant for F1.
 *
 * DFS scoring differs from the season-long official game in three key ways:
 *  1. It rewards *place differential* (positions gained) much more heavily —
 *     it is the headline stat on DraftKings F1 contests.
 *  2. It keeps the fastest-lap bonus (the official game dropped it).
 *  3. It has no teammate/quali-DSQ micro-bonuses and no constructor pit-stop
 *     scoring (DFS rosters are drivers only).
 *
 * Approximated from publicly documented DraftKings F1 DFS rules:
 *  Finishing position:  P1=45, descending; classified finishers all score.
 *  Place differential:  +3 per position gained, -3 per position lost.
 *  Fastest lap:         +5
 *  Led most laps:       (not modelled — no live signal in RaceHooks feed)
 *  DNF:                 0 (DFS does not penalise DNF beyond lost positions)
 *
 * These values are illustrative of the DFS *shape*; tune them to a specific
 * operator's rules by cloning this object.
 */
export const DFSScoringRules: ScoringRules = {
  name: "DraftKings-style DFS",

  // DFS finishing-position payout — steep at the front, every classified
  // finisher scores something. index 0 unused.
  racePositionPoints: [0, 45, 40, 34, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 5, 4, 3, 2],

  // Sprint uses the same curve scaled to ~40% (shorter race, fewer points).
  sprintPositionPoints: [0, 18, 16, 14, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0],

  // DFS contests typically do not award standalone qualifying points.
  qualifyingPositionPoints: undefined,

  positionGainedPoints: 3,
  positionLostPoints: -3,
  // DFS counts net place differential, not discrete overtakes.
  overtakePoints: 0,

  fastestLapPoints: 5,
  driverOfTheDayPoints: 0,

  // DFS imposes no DNF penalty beyond the positions naturally lost.
  raceDnfPoints: 0,
  sprintDnfPoints: 0,
  raceDisqualificationPoints: 0,

  defaultBoostMultiplier: 1.5, // "captain" slot on many DFS sites
};
