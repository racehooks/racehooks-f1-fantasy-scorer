/**
 * racehooks-f1-fantasy-scorer
 *
 * Live F1 Fantasy scoring from RaceHooks `events.race` webhook payloads.
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
  ScoringScope,
  ScoreMap,
  ConstructorScore,
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
  RaceEventEnvelope,
  RaceEventName,
  DriverRef,
  EventLapTime,
  OvertakeParticipant,
  OvertakeData,
  OvertakeCountData,
  PositionsChangedData,
  LapSeriesPositionData,
  FastestLapData,
  RetirementData,
  RetirementCauseCategory,
  PitStopCompleteData,
  SessionStartData,
  SessionCompleteData,
  LeadChangeData,
  TopThreeUpdateData,
  TopThreeUpdateEntry,
  LiveContext,
  LiveDriverRow,
} from "./events";
