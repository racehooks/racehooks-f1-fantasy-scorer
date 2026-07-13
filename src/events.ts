/**
 * Type definitions for the RaceHooks payloads the scorer consumes.
 *
 * These mirror the canonical RaceHooks payload contract exactly:
 *  - the `events.race` feed — a discriminated union of synthetic race events,
 *    each nesting a full {@link DriverRef} identity block, and
 *  - the `LiveContext` live snapshot (per-driver rows with lowercase `pos`
 *    and string `status`), for scorers that want to read the live board.
 *
 * The shapes here are a faithful subset of the RaceHooks SDK types — the
 * scorer only needs the fields it scores on, but every field name and nesting
 * matches what RaceHooks actually emits. Types are permissive (`data` is a
 * loose record on the envelope) because the feed is forward-compatible: new
 * event names may arrive that this package does not yet score, and unknown
 * events are simply ignored.
 */

/**
 * Stable driver identity block included in every `events.race` payload's
 * driver entry (and on the live rows). Never a reduced `{ driverNumber }` —
 * always the full ref. The scorer keys on `tla`.
 */
export interface DriverRef {
  /** RaceHooks driver slug (e.g. "max_verstappen"). */
  driverId: string;
  /** RaceHooks constructor slug (e.g. "red-bull"). */
  constructorId: string;
  /** F1 racing number (e.g. "1", "44"). */
  number: string;
  /** Three-letter abbreviation (e.g. "VER"). The scorer keys on this. */
  tla: string;
  /** Full driver name. */
  name: string;
  /** Team name. */
  team: string;
  [key: string]: unknown;
}

/** A lap time as delivered inside event payloads: display string + milliseconds. */
export interface EventLapTime {
  display: string; // e.g. "1:27.412"
  ms: number;
}

/** The base envelope shared by every `events.race` payload. */
export interface RaceEventEnvelope {
  /** The canonical feed discriminator. Always "events.race". */
  feed: "events.race";
  sessionId?: string | null;
  /** The event name — see {@link RaceEventName} for the documented set. */
  event: string;
  lap?: number;
  utc?: string;
  data?: Record<string, unknown>;
  _replay?: unknown;
}

/**
 * A single `events.race` delivery. Discriminated on `event`; the `data` body
 * shape depends on the event name. Kept structurally loose so the scorer can
 * firehose the whole feed at it — narrow `data` by checking `event`.
 */
export type RaceEventPayload = RaceEventEnvelope;

// ── Event `data` bodies (subset the scorer reads) ──────────────────────────

/** A driver inside an `overtake` payload: their identity + before/after slots. */
export interface OvertakeParticipant extends DriverRef {
  newPosition: number;
  prevPosition: number;
}

/** `session.start` */
export interface SessionStartData {
  sessionName: string;
  sessionType: string;
  totalLaps?: number;
}
/** `session.complete` */
export interface SessionCompleteData {
  sessionName: string;
  sessionType: string;
  winner?: DriverRef;
}
/** `overtake` — a completed on-track pass. */
export interface OvertakeData {
  overtakingDriver: OvertakeParticipant;
  overtakenDriver?: OvertakeParticipant;
}
/** `overtake.count` — cumulative overtakes for a driver so far this race. */
export interface OvertakeCountData {
  driver: DriverRef;
  cumulativeOvertakes: number;
}
/** `positions.gained` / `positions.lost` — net grid → current delta snapshot. */
export interface PositionsChangedData {
  driver: DriverRef;
  gridPosition: number;
  currentPosition: number;
  /** gridPosition − currentPosition. Negative on `positions.lost`. */
  positionsGained: number;
}
/** `lapseries.position.gained` / `lapseries.position.lost` — per-lap position move. */
export interface LapSeriesPositionData {
  driver: DriverRef;
  lap: number;
  newPosition: number;
  prevPosition: number;
  positionsGained: number;
}
/** `fastest.lap` */
export interface FastestLapData {
  driver: DriverRef;
  lapTime: EventLapTime;
  previousBest?: { driver: DriverRef; lapTime: EventLapTime };
}
export type RetirementCauseCategory = "accident" | "mechanical" | "puncture" | "unknown";
/** `retirement` */
export interface RetirementData {
  driver: DriverRef;
  positionAtRetirement: number;
  pitsCompleted: number;
  cause: RetirementCauseCategory | null;
  causeRawMessage: string | null;
}
/** `pit.stop.complete` — a finished pit stop with crew stationary time. */
export interface PitStopCompleteData {
  driver: DriverRef;
  stopNumber: number;
  lap?: number;
  totalDurationMs?: number;
  /** Crew stationary time (ms) — the metric constructor pit scoring reads. */
  stationaryMs?: number;
  pitLaneTravelMs?: number;
  pitStopTimeMs?: number;
  pitLaneTimeMs?: number;
}
/** `lead.change` */
export interface LeadChangeData {
  newLeader: DriverRef;
  previousLeader?: DriverRef;
  viaOvertake: boolean;
}
/** `top.three.update` — the current podium order. */
export interface TopThreeUpdateEntry {
  position: number;
  driver: DriverRef;
}
export interface TopThreeUpdateData {
  drivers: TopThreeUpdateEntry[];
}

/**
 * The documented `events.race` event names. The feed stays forward-compatible,
 * so `RaceEventPayload.event` remains `string` — this is the known set.
 */
export type RaceEventName =
  | "session.start"
  | "session.complete"
  | "session.finalised"
  | "overtake"
  | "overtake.count"
  | "positions.gained"
  | "positions.lost"
  | "lapseries.position.gained"
  | "lapseries.position.lost"
  | "fastest.lap"
  | "retirement"
  | "pit.stop.complete"
  | "pit.fastest"
  | "lead.change"
  | "top.three.update"
  | "safety.car.deployed"
  | "safety.car.cleared";

// ── Live snapshot (LiveContext) ────────────────────────────────────────────

/** A single row of the RaceHooks live board. */
export interface LiveDriverRow {
  pos: number;
  num: string;
  tla: string;
  name: string;
  team: string;
  gap: string;
  interval: string;
  lastLap: string;
  compound: string;
  tyreAge: number;
  pits: number;
  status: "OnTrack" | "InPit" | "Retired" | "Unknown";
}

/** The RaceHooks live-session snapshot — the computed live leaderboard. */
export interface LiveContext {
  active: boolean;
  sessionName: string;
  sessionType: string;
  currentLap: number;
  totalLaps: number;
  flag: "green" | "yellow" | "sc" | "vsc" | "red" | "checkered";
  drivers: LiveDriverRow[];
  updatedAt: number;
}
