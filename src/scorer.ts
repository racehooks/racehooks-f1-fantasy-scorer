import type { ScoringRules, ScoringLogEntry, ScoreMap, SessionKind, RosterBoost } from "./rules/types";
import { ScoringRulesValidator } from "./rules/validator";
import type { RaceEventPayload, TimingDataPayload } from "./events";

/** Configuration for a {@link FantasyScorer} instance. */
export interface ScorerConfig {
  /** The scoring rule set to apply. */
  rules: ScoringRules;
  /**
   * Driver TLAs that count toward the lineup. Events for drivers outside the
   * roster are ignored (no points, no log entry). Omit to score every driver
   * seen in the feed.
   */
  roster?: string[];
  /**
   * Optional turbo/mega/captain boost: the named driver's *total* is
   * multiplied by `multiplier`. The multiplier is applied on read
   * ({@link FantasyScorer.getScores}) so it always reflects the live total.
   */
  boost?: RosterBoost;
  /**
   * Starting grid positions keyed by TLA, used for positions-gained scoring at
   * the finish. If omitted, the scorer infers the start position from the first
   * position it observes for each driver in the race session.
   */
  gridPositions?: Record<string, number>;
}

type ScoreListener = (scores: ScoreMap, event: ScoringLogEntry) => void;

interface DriverState {
  /** Most recent on-track position observed this session. */
  lastPosition?: number;
  /** First position observed in the race (fallback start position). */
  inferredStart?: number;
  /** Cumulative discrete overtakes credited (race/sprint). */
  overtakes: number;
  /** Whether this driver has already been scored a DNF. */
  dnfScored: boolean;
  /** Whether this driver's finish has been scored. */
  finishScored: boolean;
  /** Whether this driver's qualifying position has been scored. */
  qualiScored: boolean;
}

/**
 * Map of `raceevent` names to the brief's alias names so either works.
 * Keys are the alias; values are the canonical RaceHooks event name.
 */
const EVENT_ALIASES: Record<string, string> = {
  driver_finished: "driver_finished", // synthetic — no native equivalent
  fastest_lap: "fastest.lap",
  pit_stop_confirmed: "pit.stop.complete",
  pit_stop_completed: "pit.stop.completed",
  overtake: "overtake",
  dnf: "retirement",
  driver_retired: "retirement",
  safety_car: "safety.car.deployed",
  driver_of_the_day: "driver_of_the_day", // synthetic — no native equivalent
};

/**
 * FantasyScorer — turns a live stream of RaceHooks `raceevent` + `timingdata`
 * payloads into running fantasy point totals per driver.
 *
 * The scorer is event-sourced: every scoring decision appends to an immutable
 * log ({@link getEventLog}) and the running totals ({@link getScores}) are the
 * sum of that log (plus any boost multiplier). It is deterministic and
 * side-effect-free apart from the `scoreUpdate` listener callbacks.
 *
 * @example
 * ```ts
 * const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["VER", "NOR"] });
 * scorer.on("scoreUpdate", (scores) => console.log(scores));
 * scorer.processEvent(raceEvent);
 * scorer.processTimingUpdate(timingData);
 * scorer.getScores(); // { VER: 34, NOR: 18 }
 * ```
 */
export class FantasyScorer {
  private readonly rules: ScoringRules;
  private readonly roster?: Set<string>;
  private readonly boost?: RosterBoost;
  private readonly gridPositions: Record<string, number>;

  private readonly log: ScoringLogEntry[] = [];
  private readonly totals: ScoreMap = {};
  private readonly state = new Map<string, DriverState>();
  private readonly listeners = new Set<ScoreListener>();

  /** Current session kind, derived from `session.start` events. Defaults to race. */
  private session: SessionKind = "race";
  /** Driver TLA → numeric→TLA mapping helper (some events arrive by number). */
  private readonly numberToTla = new Map<string, string>();

  /** Fastest pit stop seen so far, for the constructor fastest-stop bonus. */
  private fastestPitMs = Number.POSITIVE_INFINITY;
  private fastestPitDriver?: string;

  constructor(config: ScorerConfig) {
    ScoringRulesValidator.assertValid(config.rules);
    this.rules = config.rules;
    this.roster = config.roster ? new Set(config.roster.map((d) => d.toUpperCase())) : undefined;
    this.boost = config.boost;
    this.gridPositions = { ...(config.gridPositions ?? {}) };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Subscribe to score changes. Returns an unsubscribe function. */
  on(event: "scoreUpdate", listener: ScoreListener): () => void {
    if (event !== "scoreUpdate") throw new Error(`Unknown event "${event}"`);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Remove a previously-registered listener. */
  off(listener: ScoreListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Process a single `raceevent` webhook payload. Unknown / non-scoring events
   * are silently ignored, so it is safe to firehose the entire feed at it.
   */
  processEvent(payload: RaceEventPayload): void {
    if (!payload || typeof payload !== "object") return;
    const rawEvent = String(payload.event ?? "");
    const event = EVENT_ALIASES[rawEvent] ?? rawEvent;
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const at = payload.utc ?? new Date().toISOString();

    switch (event) {
      case "session.start":
        this.onSessionStart(data);
        return;
      case "overtake":
        this.onOvertake(data, at);
        return;
      case "fastest.lap":
        this.onFastestLap(data, at);
        return;
      case "retirement":
        this.onRetirement(data, at);
        return;
      case "pit.stop.complete":
      case "pit.stop.completed":
        this.onPitStop(data, at);
        return;
      case "qualifying.segment.end":
        // Qualifying classification is scored from the final timingdata,
        // not the segment event — no-op here.
        return;
      case "driver_finished":
        this.onDriverFinished(data, at);
        return;
      case "driver_of_the_day":
        this.onDriverOfTheDay(data, at);
        return;
      default:
        return;
    }
  }

  /**
   * Process a `timingdata` webhook payload. The scorer mines it for:
   *  - position tracking (to infer start positions + final classification),
   *  - retirements (Status === 3) it has not already scored,
   *  - the driver-number → TLA mapping.
   *
   * Finishing/qualifying classification is scored when {@link finalize} is
   * called (typically on `session.complete`), using the last positions seen.
   */
  processTimingUpdate(payload: TimingDataPayload): void {
    const drivers = payload?.drivers;
    if (!drivers) return;
    const at = new Date().toISOString();

    for (const d of drivers) {
      const driverNum = d.number ?? d.driver ?? "";
      const tla = d.tla ? d.tla.toUpperCase() : undefined;
      // Register number → TLA mapping from the normalized entry.
      if (tla && driverNum) this.numberToTla.set(driverNum, tla);
      // Consult pre-registered mapping (e.g. from registerDriver()) when
      // the current entry has no tla — preserves registerDriver() contracts.
      const resolvedTla = tla ?? this.numberToTla.get(driverNum);

      // Prefer TLA if roster is TLA-keyed; fall back to driver number for
      // number-keyed rosters (e.g. roster: ["1", "44"]).
      const scoringKey =
        resolvedTla && this.inRoster(resolvedTla)
          ? resolvedTla
          : this.inRoster(driverNum)
            ? driverNum
            : undefined;
      if (!scoringKey) continue;
      const st = this.ensureState(scoringKey);

      const pos = d.Position !== undefined ? Number(d.Position) : undefined;
      if (pos !== undefined && Number.isFinite(pos)) {
        if (st.inferredStart === undefined) st.inferredStart = pos;
        st.lastPosition = pos;
      }

      // Retirement straight from timing status (Status 3 = retired).
      const statusNum = d.Status !== undefined ? Number(d.Status) : undefined;
      const retired = statusNum === 3 || d.Retired === true || d.Stopped === true;
      if (retired && !st.dnfScored) {
        this.scoreDnf(scoringKey, st.lastPosition ?? pos, at);
      }
    }
  }

  /**
   * Finalise classification scoring for the current session: awards finishing
   * position points, positions-gained/lost, and (for qualifying sessions)
   * qualifying position points, using each driver's last observed position.
   *
   * Call this when you receive `session.complete`. Calling it more than once
   * is safe — already-scored drivers are skipped.
   */
  finalize(at: string = new Date().toISOString()): void {
    if (this.session === "qualifying") {
      this.finalizeQualifying(at);
    } else {
      this.finalizeRace(at);
    }
  }

  /**
   * Convenience: feed any payload (raceevent or timingdata) and the scorer will
   * route it. Also auto-finalises on `session.complete`.
   */
  ingest(payload: RaceEventPayload | TimingDataPayload): void {
    if ((payload as RaceEventPayload).feed === "raceevent") {
      const rp = payload as RaceEventPayload;
      const ev = EVENT_ALIASES[String(rp.event)] ?? String(rp.event);
      this.processEvent(rp);
      if (ev === "session.complete") this.finalize(rp.utc);
      return;
    }
    this.processTimingUpdate(payload as TimingDataPayload);
  }

  /** Current running totals per driver (boost applied). */
  getScores(): ScoreMap {
    const out: ScoreMap = {};
    for (const [driver, raw] of Object.entries(this.totals)) {
      out[driver] = this.applyBoost(driver, raw);
    }
    return out;
  }

  /** The score for a single driver (boost applied), or 0 if unseen. */
  getScore(driver: string): number {
    const tla = driver.toUpperCase();
    return this.applyBoost(tla, this.totals[tla] ?? 0);
  }

  /** The full, ordered log of every scoring event. */
  getEventLog(): ReadonlyArray<ScoringLogEntry> {
    return this.log;
  }

  /** The current session kind. */
  getSession(): SessionKind {
    return this.session;
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  private onSessionStart(data: Record<string, unknown>): void {
    const type = String(data.sessionType ?? data.session ?? "").toLowerCase();
    if (type.includes("sprint")) this.session = "sprint";
    else if (type.includes("qual")) this.session = "qualifying";
    else if (type.includes("race") || type.includes("grand prix")) this.session = "race";
  }

  private onOvertake(data: Record<string, unknown>, at: string): void {
    if (this.session !== "race" && this.session !== "sprint") return;
    const tla = this.tlaFromData(data);
    if (!tla || !this.inRoster(tla)) return;
    const pts = this.rules.overtakePoints ?? 0;
    if (pts === 0) return;

    const st = this.ensureState(tla);
    // OvertakeSeries delivers a cumulative count; credit only the delta.
    const cumulative = data.cumulativeOvertakes;
    if (typeof cumulative === "number") {
      const delta = cumulative - st.overtakes;
      if (delta <= 0) return;
      st.overtakes = cumulative;
      this.award(tla, pts * delta, "OVERTAKE", at, { count: delta, cumulative });
    } else {
      st.overtakes += 1;
      this.award(tla, pts, "OVERTAKE", at, {
        from: data.fromPosition,
        to: data.toPosition,
      });
    }
  }

  private onFastestLap(data: Record<string, unknown>, at: string): void {
    const pts = this.rules.fastestLapPoints ?? 0;
    if (pts === 0) return; // official game has no fastest-lap bonus
    const tla = this.tlaFromData(data);
    if (!tla || !this.inRoster(tla)) return;
    // Only the final fastest lap matters; re-score by replacing prior award.
    this.removeAwards(tla, "FASTEST_LAP");
    this.award(tla, pts, "FASTEST_LAP", at, { lapTime: data.lapTime });
  }

  private onRetirement(data: Record<string, unknown>, at: string): void {
    const tla = this.tlaFromData(data);
    if (!tla || !this.inRoster(tla)) return;
    const st = this.ensureState(tla);
    if (st.dnfScored) return;
    this.scoreDnf(tla, Number(data.positionAtRetirement) || st.lastPosition, at);
  }

  private onPitStop(data: Record<string, unknown>, at: string): void {
    // Constructor / team pit-stop scoring, keyed on stationary duration.
    const bands = this.rules.pitStopBands;
    if (!bands) return;
    const tla = this.tlaFromData(data);
    if (!tla || !this.inRoster(tla)) return;

    const ms = Number(data.stationaryMs ?? data.pitStopTimeMs);
    if (!Number.isFinite(ms) || ms <= 0) return;

    const band = bands.find((b) => ms >= b.minMs && ms < b.maxMs);
    if (band && band.points !== 0) {
      this.award(tla, band.points, "PIT_STOP_TIME", at, { stationaryMs: ms });
    }

    // Fastest-stop-of-the-race bonus: re-award when a new fastest is seen.
    if (this.rules.fastestPitStopBonus && ms < this.fastestPitMs) {
      if (this.fastestPitDriver) this.removeAwards(this.fastestPitDriver, "FASTEST_PIT_STOP");
      this.fastestPitMs = ms;
      this.fastestPitDriver = tla;
      this.award(tla, this.rules.fastestPitStopBonus, "FASTEST_PIT_STOP", at, { stationaryMs: ms });
    }

    // World-record bonus.
    if (
      this.rules.pitStopWorldRecordBonus &&
      this.rules.pitStopWorldRecordMs !== undefined &&
      ms < this.rules.pitStopWorldRecordMs
    ) {
      this.award(tla, this.rules.pitStopWorldRecordBonus, "PIT_STOP_WORLD_RECORD", at, { stationaryMs: ms });
    }
  }

  private onDriverFinished(data: Record<string, unknown>, at: string): void {
    const tla = this.tlaFromData(data);
    if (!tla || !this.inRoster(tla)) return;
    const st = this.ensureState(tla);
    const position = Number(data.position);
    if (!Number.isFinite(position)) return;
    st.lastPosition = position;
    const grid = Number(data.gridPosition);
    if (Number.isFinite(grid)) this.gridPositions[tla] = grid;
    if (data.classified === false) {
      this.scoreDnf(tla, position, at);
      return;
    }
    this.scoreFinish(tla, position, at);
  }

  private onDriverOfTheDay(data: Record<string, unknown>, at: string): void {
    const pts = this.rules.driverOfTheDayPoints ?? 0;
    if (pts === 0) return;
    const tla = this.tlaFromData(data);
    if (!tla || !this.inRoster(tla)) return;
    this.removeAwards(tla, "DRIVER_OF_THE_DAY");
    this.award(tla, pts, "DRIVER_OF_THE_DAY", at);
  }

  // ── Classification scoring ───────────────────────────────────────────────────

  private finalizeRace(at: string): void {
    const table = this.session === "sprint" ? this.rules.sprintPositionPoints : this.rules.racePositionPoints;
    for (const [tla, st] of this.state) {
      if (st.dnfScored || st.finishScored) continue;
      if (st.lastPosition === undefined) continue;
      this.scoreFinish(tla, st.lastPosition, at, table);
    }
  }

  private finalizeQualifying(at: string): void {
    const table = this.rules.qualifyingPositionPoints;
    if (!table) return;
    for (const [tla, st] of this.state) {
      if (st.qualiScored || st.lastPosition === undefined) continue;
      st.qualiScored = true;
      const pts = table[st.lastPosition] ?? 0;
      if (pts !== 0) {
        this.award(tla, pts, `QUALI_P${st.lastPosition}`, at, { position: st.lastPosition });
      }
    }
  }

  private scoreFinish(tla: string, position: number, at: string, table?: number[]): void {
    const st = this.ensureState(tla);
    if (st.finishScored) return;
    st.finishScored = true;

    const posTable =
      table ?? (this.session === "sprint" ? this.rules.sprintPositionPoints : this.rules.racePositionPoints);
    const finishPts = posTable?.[position] ?? 0;
    if (finishPts !== 0) {
      this.award(tla, finishPts, `P${position}_FINISH`, at, { position });
    }

    // Positions gained / lost relative to start.
    const start = this.gridPositions[tla] ?? st.inferredStart;
    if (start !== undefined) {
      const delta = start - position; // positive = gained
      if (delta > 0 && this.rules.positionGainedPoints) {
        this.award(tla, this.rules.positionGainedPoints * delta, "POSITIONS_GAINED", at, {
          start,
          finish: position,
          gained: delta,
        });
      } else if (delta < 0 && this.rules.positionLostPoints) {
        this.award(tla, this.rules.positionLostPoints * -delta, "POSITIONS_LOST", at, {
          start,
          finish: position,
          lost: -delta,
        });
      }
    }
  }

  private scoreDnf(tla: string, _position: number | undefined, at: string): void {
    const st = this.ensureState(tla);
    if (st.dnfScored || st.finishScored) return;
    st.dnfScored = true;
    const pts = this.session === "sprint" ? this.rules.sprintDnfPoints ?? 0 : this.rules.raceDnfPoints ?? 0;
    if (pts !== 0) {
      this.award(tla, pts, "DNF", at, { session: this.session });
    }
  }

  // ── Scoring primitives ────────────────────────────────────────────────────────

  private award(driver: string, points: number, reason: string, at: string, detail?: Record<string, unknown>): void {
    const entry: ScoringLogEntry = { driver, points, reason, at, session: this.session, detail };
    this.log.push(entry);
    this.totals[driver] = (this.totals[driver] ?? 0) + points;
    this.emit(entry);
  }

  /** Reverse all prior awards for a driver+reason (used for "latest wins" bonuses). */
  private removeAwards(driver: string, reason: string): void {
    let removed = 0;
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log[i];
      if (e.driver === driver && e.reason === reason) {
        removed += e.points;
        this.log.splice(i, 1);
      }
    }
    if (removed !== 0) this.totals[driver] = (this.totals[driver] ?? 0) - removed;
  }

  private applyBoost(driver: string, raw: number): number {
    if (this.boost && this.boost.driver.toUpperCase() === driver) {
      return raw * this.boost.multiplier;
    }
    return raw;
  }

  private emit(event: ScoringLogEntry): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.getScores();
    for (const l of this.listeners) l(snapshot, event);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────

  private ensureState(tla: string): DriverState {
    let st = this.state.get(tla);
    if (!st) {
      st = { overtakes: 0, dnfScored: false, finishScored: false, qualiScored: false };
      this.state.set(tla, st);
    }
    return st;
  }

  private inRoster(tla: string): boolean {
    return this.roster === undefined || this.roster.has(tla.toUpperCase());
  }

  private tlaFromData(data: Record<string, unknown>): string | undefined {
    const tla = data.tla ?? (data.driver && this.numberToTla.get(String(data.driver)));
    if (typeof tla === "string" && tla.length > 0) return tla.toUpperCase();
    // Fall back to raw driver field if it already looks like a TLA.
    const raw = data.driver;
    if (typeof raw === "string" && /^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
    return undefined;
  }

  /** Register a driver-number → TLA mapping (e.g. from a DriverList feed). */
  registerDriver(driverNumber: string, tla: string): void {
    this.numberToTla.set(driverNumber, tla.toUpperCase());
  }
}
