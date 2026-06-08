/**
 * @racehooks/fantasy-scorer
 *
 * Live F1 Fantasy scoring from RaceHooks webhook events.
 */

export { FantasyScorer } from "./scorer";
export type { ScorerConfig } from "./scorer";

export {
  OfficialF1ScoringRules,
  DFSScoringRules,
  ScoringRulesValidator,
} from "./rules";
export type {
  ScoringRules,
  ScoringLogEntry,
  ScoreMap,
  SessionKind,
  PositionPointsTable,
  PitStopBand,
  RosterBoost,
  ValidationResult,
} from "./rules";

export { RosterOptimizer } from "./optimizer";
export type {
  DriverCandidate,
  OptimizerConstraints,
  OptimizedRoster,
} from "./optimizer";

export type {
  RaceEventPayload,
  TimingDataPayload,
  TimingLine,
  DriverRef,
  DriverFinishedData,
} from "./events";
