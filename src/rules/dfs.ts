import type { ScoringRules } from "./types";

/**
 * DFSScoringRules — an **illustrative** Daily Fantasy Sports (DFS) variant for
 * F1. This is a generic DFS *shape*, not any specific operator's rule set —
 * clone it and tune the numbers to whatever contest you are scoring.
 *
 * DFS scoring differs from the season-long official game in three key ways:
 *  1. It rewards *place differential* (positions gained) much more heavily —
 *     it is typically the headline stat on DFS contests.
 *  2. It keeps the fastest-lap bonus (the official game dropped it).
 *  3. It has no teammate/quali micro-bonuses and no constructor pit-stop
 *     scoring (DFS rosters are drivers only).
 *
 * Illustrative DFS payout shape:
 *  Finishing position:  P1=45, descending; classified finishers all score.
 *  Place differential:  +3 per position gained, -3 per position lost.
 *  Fastest lap:         +5
 *  DNF:                 0 (this shape does not penalise DNF beyond lost places)
 *
 * These values illustrate the DFS *shape*; they are not sourced from any real
 * contest. Clone this object to model a specific operator's published rules.
 */
export const DFSScoringRules: ScoringRules = {
  name: "DFS (illustrative)",

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

  defaultBoostMultiplier: 1.5, // a "captain"-style multiplier common in DFS
};
