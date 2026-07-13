/**
 * Scoring rule types for the F1 Fantasy Scorer.
 *
 * A `ScoringRules` object is a pure, declarative description of how RaceHooks
 * `events.race` payloads translate into fantasy points. The
 * {@link FantasyScorer} consumes these rules; it never hard-codes a point value.
 *
 * Two complete rule sets ship with the package — `OfficialF1ScoringRules`
 * (the official F1 Fantasy game) and `DFSScoringRules` (an illustrative DFS
 * variant) — and you can supply any custom object that satisfies this shape.
 */

/** Session phase a scoring rule applies to. */
export type SessionKind = "race" | "sprint" | "qualifying";

/**
 * A position → points lookup. Index 0 is unused; index N is the points awarded
 * for finishing/qualifying in position N. Positions beyond the array length
 * score 0. Negative values are permitted (e.g. a DFS bottom-finish penalty).
 */
export type PositionPointsTable = number[];

/** Pit-stop duration → points band (constructor scoring). */
export interface PitStopBand {
  /** Inclusive lower bound of the stationary/stop time in milliseconds. */
  minMs: number;
  /** Exclusive upper bound of the stationary/stop time in milliseconds. */
  maxMs: number;
  /** Points awarded when a stop falls in `[minMs, maxMs)`. */
  points: number;
}

/**
 * The full, self-contained description of a fantasy scoring system.
 *
 * Every field is optional except `name` and `racePositionPoints`.
 * `ScoringRulesValidator` enforces the required subset and flags
 * inconsistencies (e.g. a positive DNF penalty).
 */
export interface ScoringRules {
  /** Human-readable identifier, surfaced in the event log and validation errors. */
  name: string;

  // ── Position-based scoring ──────────────────────────────────────────────
  /** Points for finishing position in the Grand Prix. Index = position. */
  racePositionPoints: PositionPointsTable;
  /** Points for finishing position in the Sprint. Index = position. */
  sprintPositionPoints?: PositionPointsTable;
  /** Points for grid/qualifying position. Index = position. */
  qualifyingPositionPoints?: PositionPointsTable;

  // ── Dynamic race scoring ────────────────────────────────────────────────
  /** Points per position gained (start → finish). Applied per place. */
  positionGainedPoints?: number;
  /** Points per position lost (negative or zero). Applied per place. */
  positionLostPoints?: number;
  /** Points per on-track overtake. */
  overtakePoints?: number;

  // ── Bonuses ─────────────────────────────────────────────────────────────
  /** Fastest-lap bonus (race). The official 2025+ game dropped this — leave unset for parity. */
  fastestLapPoints?: number;
  /** Driver of the Day bonus. */
  driverOfTheDayPoints?: number;
  /** Bonus for beating your teammate in qualifying. */
  beatTeammateQualifyingPoints?: number;
  /** Bonus for beating your teammate in the race. */
  beatTeammateRacePoints?: number;

  // ── Penalties ───────────────────────────────────────────────────────────
  /** Penalty for a race DNF / not-classified result (negative). */
  raceDnfPoints?: number;
  /** Penalty for a sprint DNF / not-classified result (negative). */
  sprintDnfPoints?: number;

  // ── Constructor / pit-stop scoring ──────────────────────────────────────
  /**
   * Pit-stop duration bands for constructor scoring. Bands are evaluated in
   * order; the first match wins. Driven by `stationaryMs` from
   * `pit.stop.complete`.
   */
  pitStopBands?: PitStopBand[];
  /** Bonus for the team that records the fastest pit stop of the race. */
  fastestPitStopBonus?: number;
  /** Bonus for a team that sets a new pit-stop world record. */
  pitStopWorldRecordBonus?: number;
  /** Threshold (ms) under which a stop is treated as a world-record stop. */
  pitStopWorldRecordMs?: number;

  // ── Multipliers ─────────────────────────────────────────────────────────
  /**
   * Canonical boost multiplier for this rule set (the official game uses 2x
   * for the nominated turbo driver). The actual boosted driver is chosen
   * per-roster via {@link ScorerConfig.boost}; this value documents the default.
   */
  defaultBoostMultiplier?: number;
}

/** Whether a scoring entry credits a driver total or a constructor total. */
export type ScoringScope = "driver" | "constructor";

/** A single scoring event recorded by the scorer's event log. */
export interface ScoringLogEntry {
  /** Whether this entry accrues to a driver or a constructor. */
  scope: ScoringScope;
  /**
   * The subject the points accrue to: a driver TLA (e.g. "VER") for
   * `scope: "driver"`, or a constructor slug (e.g. "ferrari") for
   * `scope: "constructor"`.
   */
  driver: string;
  /** Points awarded by this event (may be negative). */
  points: number;
  /** Machine-readable reason code, e.g. "P1_FINISH", "OVERTAKE", "DNF". */
  reason: string;
  /** ISO-8601 timestamp the underlying webhook reported. */
  at: string;
  /** Session the event belongs to. */
  session: SessionKind;
  /** Optional free-form detail (positions, lap times, etc.). */
  detail?: Record<string, unknown>;
}

/** Map of driver TLA → running point total. */
export type ScoreMap = Record<string, number>;

/** A constructor's aggregated fantasy score. */
export interface ConstructorScore {
  /** Canonical RaceHooks constructor slug (e.g. "ferrari"). */
  constructorId: string;
  /** Display team name, when seen in the feed. */
  team?: string;
  /** TLAs of the constructor's drivers seen in the feed. */
  drivers: string[];
  /** Combined driver points of this constructor's drivers. */
  driverPoints: number;
  /** Constructor pit-stop performance points (bands + bonuses). */
  pitStopPoints: number;
  /** driverPoints + pitStopPoints. */
  total: number;
}

/** A roster boost assignment: which driver gets the multiplier and what it is. */
export interface RosterBoost {
  driver: string;
  multiplier: number;
}
