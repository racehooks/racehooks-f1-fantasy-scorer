/**
 * Type definitions for the RaceHooks webhook payloads the scorer consumes.
 *
 * These mirror the payloads emitted by `emitRaceEvent(...)` in
 * `src/common/liveFeed/feedHandlers.ts` (the `raceevent` feed) and the
 * `timingdata` feed. They are intentionally permissive — RaceHooks may add
 * fields over time, and a fantasy scorer only needs a subset.
 *
 * The full list of `raceevent` event names emitted by RaceHooks today:
 *   session.start, session.complete, session.finalised,
 *   session.clock.paused, session.clock.resumed, session.restart.scheduled,
 *   safety.car.deployed, safety.car.cleared,
 *   red.flag.deployed, red.flag.cleared, red.flag.restart.sc,
 *   speedtrap.update,
 *   qualifying.segment.start, qualifying.segment.end,
 *   qualifying.hot_lap.started, qualifying.hot_lap.aborted,
 *   pit.entry, pit.exit, pit.stop.complete, pit.stop.completed,
 *   retirement, overtake, lead.change, fastest.lap
 *
 * The scorer additionally recognises a small set of *aliases* the task brief
 * uses (driver_finished, fastest_lap, pit_stop_confirmed, dnf, driver_retired,
 * driver_of_the_day) so that either naming convention works as input.
 */

/** Driver identity block that RaceHooks attaches to most race events. */
export interface DriverRef {
  /** F1 racing number (e.g. "1", "44"). */
  driver?: string;
  /** Three-letter abbreviation (e.g. "VER"). The scorer keys on this. */
  tla?: string;
  /** Team name. */
  team?: string;
}

/** The envelope shape of every `raceevent` payload. */
export interface RaceEventPayload {
  type: "raceevent";
  sessionId?: string | null;
  /** Event name — see the list in the module doc. */
  event: string;
  lap?: number | null;
  utc?: string;
  data?: Record<string, unknown>;
}

/** A single driver line inside a `timingdata` payload's `Lines` map. */
export interface TimingLine {
  Position?: number | string;
  /** F1 status code: 4 = in pit, 3 = retired, else on track. */
  Status?: number | string;
  NumberOfPitStops?: number | string;
  RacingNumber?: string;
  BestLapTime?: { Value?: string };
  Retired?: boolean;
  Stopped?: boolean;
}

/** The `timingdata` payload envelope. */
export interface TimingDataPayload {
  type?: "timingdata";
  sessionId?: string | null;
  data?: {
    Lines?: Record<string, TimingLine>;
  };
  /** RaceHooks also accepts a flattened `Lines` at the top of `data`. */
  Lines?: Record<string, TimingLine>;
}

/**
 * A finishing-grid event. RaceHooks does not emit a single canonical
 * "driver_finished" event today — the final classification is derived from the
 * last `timingdata` positions when `session.complete` fires. The scorer also
 * accepts an explicit `driver_finished` raceevent (the task brief's naming) so
 * integrators who synthesise one upstream can feed it directly.
 */
export interface DriverFinishedData extends DriverRef {
  position: number;
  /** Grid/start position, used for positions-gained scoring. */
  gridPosition?: number;
  classified?: boolean;
}
