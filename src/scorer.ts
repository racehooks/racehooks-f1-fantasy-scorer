import type {
  ScoringRules,
  ScoringLogEntry,
  ScoreMap,
  SessionKind,
  RosterBoost,
  ScoringScope,
  ConstructorScore,
} from "./rules/types";
import { ScoringRulesValidator } from "./rules/validator";
import type { RaceEventPayload, DriverRef, LiveContext } from "./events";

/** Configuration for a {@link FantasyScorer} instance. */
export interface ScorerConfig {
  /** The scoring rule set to apply. */
  rules: ScoringRules;
  /**
   * Driver TLAs (or racing numbers) that count toward the lineup. Events for
   * drivers outside the roster are still observed (so teammate comparisons and
   * constructor totals stay correct) but score no points. Omit to score every
   * driver seen in the feed.
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
   * the finish. If omitted, the scorer uses the `gridPosition` carried on
   * `positions.gained`/`positions.lost` events, then falls back to the first
   * position it observes for each driver in the race session.
   */
  gridPositions?: Record<string, number>;
  /**
   * Optional Driver of the Day TLA. Driver of the Day is **not** an
   * `events.race` event — it is an external, editorially-decided input — so it
   * is supplied here (or via {@link FantasyScorer.setDriverOfTheDay}) rather
   * than scored from the feed.
   */
  driverOfTheDay?: string;
}

type ScoreListener = (scores: ScoreMap, event: ScoringLogEntry) => void;

interface DriverState {
  tla: string;
  /** Constructor slug, learned from the driver's DriverRef. */
  constructorId?: string;
  /** Display team name, learned from the driver's DriverRef. */
  team?: string;
  /** Racing number, learned from the driver's DriverRef. */
  number?: string;
  /** Most recent on-track position observed this session. */
  lastPosition?: number;
  /** Grid position carried on a positions.gained/lost event. */
  gridPosition?: number;
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
  /** Whether this driver has been credited a beat-teammate bonus. */
  beatTeammateScored: boolean;
}

/**
 * FantasyScorer — turns a live stream of RaceHooks `events.race` payloads (and,
 * optionally, `LiveContext` snapshots) into running fantasy point totals per
 * driver, plus aggregated constructor scores.
 *
 * The scorer is event-sourced: every scoring decision appends to an immutable
 * log ({@link getEventLog}) and the running totals ({@link getScores}) are the
 * sum of that log (plus any boost multiplier). It is deterministic and
 * side-effect-free apart from the `scoreUpdate` listener callbacks. Unknown or
 * non-scoring events are ignored, so it is safe to firehose the whole feed.
 *
 * @example
 * ```ts
 * const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["VER", "NOR"] });
 * scorer.on("scoreUpdate", (scores) => console.log(scores));
 * for (const payload of raceEventDeliveries) scorer.ingest(payload);
 * scorer.getScores(); // { VER: 25, NOR: 14 }
 * ```
 */
export class FantasyScorer {
  private readonly rules: ScoringRules;
  private readonly roster?: Set<string>;
  private readonly boost?: RosterBoost;
  private readonly gridPositions: Record<string, number>;

  private readonly log: ScoringLogEntry[] = [];
  /** Driver TLA → running driver points. */
  private readonly totals: ScoreMap = {};
  /** Constructor slug → running pit-stop points. */
  private readonly constructorPitTotals: Record<string, number> = {};
  private readonly state = new Map<string, DriverState>();
  private readonly listeners = new Set<ScoreListener>();
  /** Racing number → TLA, for number-keyed rosters / live rows. */
  private readonly numberToTla = new Map<string, string>();

  /** Current session kind, derived from `session.start` events. Defaults to race. */
  private session: SessionKind = "race";
  /** Externally-supplied Driver of the Day TLA, if any. */
  private driverOfTheDay?: string;

  /** Fastest pit stop seen so far (constructor bonus): stationary ms + constructor. */
  private fastestPitMs = Number.POSITIVE_INFINITY;
  private fastestPitConstructor?: string;

  constructor(config: ScorerConfig) {
    ScoringRulesValidator.assertValid(config.rules);
    this.rules = config.rules;
    this.roster = config.roster ? new Set(config.roster.map((d) => d.toUpperCase())) : undefined;
    this.boost = config.boost;
    this.gridPositions = { ...(config.gridPositions ?? {}) };
    if (config.driverOfTheDay) this.setDriverOfTheDay(config.driverOfTheDay);
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
   * Process a single `events.race` webhook payload. Routes on the real `event`
   * discriminator and reads the nested {@link DriverRef}. Unknown / non-scoring
   * events are silently ignored, so it is safe to firehose the entire feed.
   */
  processEvent(payload: RaceEventPayload): void {
    if (!payload || typeof payload !== "object") return;
    const event = String(payload.event ?? "");
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const at = payload.utc ?? new Date().toISOString();

    switch (event) {
      case "session.start":
        this.onSessionStart(data);
        return;
      case "session.complete":
        this.onSessionComplete(data);
        return;
      case "overtake":
        this.onOvertake(data, at);
        return;
      case "overtake.count":
        this.onOvertakeCount(data, at);
        return;
      case "positions.gained":
      case "positions.lost":
        this.onPositionsChanged(data);
        return;
      case "lapseries.position.gained":
      case "lapseries.position.lost":
        this.onLapSeriesPosition(data);
        return;
      case "fastest.lap":
        this.onFastestLap(data, at);
        return;
      case "retirement":
        this.onRetirement(data, at);
        return;
      case "pit.stop.complete":
        this.onPitStop(data, at);
        return;
      case "lead.change":
        this.onLeadChange(data);
        return;
      case "top.three.update":
        this.onTopThreeUpdate(data);
        return;
      default:
        return;
    }
  }

  /**
   * Process a RaceHooks {@link LiveContext} snapshot: mines each row for its
   * live position (`pos`), retirement (`status === "Retired"`), and the
   * driver's constructor identity. Purely additive to the event stream —
   * finishing classification is still scored on `session.complete`/`finalize`.
   */
  processLiveUpdate(ctx: LiveContext): void {
    const rows = ctx?.drivers;
    if (!Array.isArray(rows)) return;
    const at = new Date().toISOString();

    for (const row of rows) {
      const ref: DriverRef = {
        driverId: "",
        constructorId: "",
        number: String(row.num ?? ""),
        tla: String(row.tla ?? ""),
        name: String(row.name ?? ""),
        team: String(row.team ?? ""),
      };
      const st = this.observe(ref, typeof row.pos === "number" ? row.pos : undefined);
      if (!st) continue;
      if (row.status === "Retired" && !st.dnfScored && this.inRoster(st)) {
        this.scoreDnf(st, at);
      }
    }
  }

  /**
   * Finalise classification scoring for the current session: awards finishing
   * position points, positions gained/lost, beat-teammate bonuses, and (for
   * qualifying sessions) qualifying position points, using each driver's last
   * observed position.
   *
   * Call this when you receive `session.complete` (or let {@link ingest} do it
   * for you). Calling it more than once is safe — already-scored drivers are
   * skipped.
   */
  finalize(at: string = new Date().toISOString()): void {
    if (this.session === "qualifying") {
      this.finalizeQualifying(at);
      this.scoreBeatTeammate("qualifying", at);
    } else {
      this.finalizeRace(at);
      this.scoreBeatTeammate(this.session, at);
    }
  }

  /**
   * Convenience router: feed any `events.race` payload and the scorer dispatches
   * it, auto-finalising on `session.complete`.
   */
  ingest(payload: RaceEventPayload): void {
    this.processEvent(payload);
    if (String(payload.event) === "session.complete") this.finalize(payload.utc);
  }

  /**
   * Nominate the Driver of the Day (an external, editorial input — not a feed
   * event). Idempotent: re-calling moves the bonus to the new driver.
   */
  setDriverOfTheDay(tla: string): void {
    const key = tla.toUpperCase();
    const pts = this.rules.driverOfTheDayPoints ?? 0;
    if (this.driverOfTheDay) this.removeAwards("driver", this.driverOfTheDay, "DRIVER_OF_THE_DAY");
    this.driverOfTheDay = key;
    if (pts === 0) return;
    const st = this.ensureState(key);
    if (!this.inRoster(st)) return;
    this.award("driver", key, pts, "DRIVER_OF_THE_DAY", new Date().toISOString());
  }

  /** Current running driver totals per TLA (boost applied). */
  getScores(): ScoreMap {
    const out: ScoreMap = {};
    for (const [driver, raw] of Object.entries(this.totals)) {
      out[driver] = this.applyBoost(driver, raw);
    }
    return out;
  }

  /** The driver score for a single TLA (boost applied), or 0 if unseen. */
  getScore(driver: string): number {
    const tla = driver.toUpperCase();
    return this.applyBoost(tla, this.totals[tla] ?? 0);
  }

  /**
   * Aggregated constructor scores: each constructor's combined driver points
   * plus its pit-stop performance points. For a *complete* constructor total,
   * run the scorer without a `roster` so every driver's points are tracked;
   * with a roster, only rostered drivers' points are aggregated.
   */
  getConstructorScores(): ConstructorScore[] {
    const map = new Map<string, ConstructorScore>();
    const ensure = (constructorId: string): ConstructorScore => {
      let c = map.get(constructorId);
      if (!c) {
        c = { constructorId, drivers: [], driverPoints: 0, pitStopPoints: 0, total: 0 };
        map.set(constructorId, c);
      }
      return c;
    };

    for (const st of this.state.values()) {
      if (!st.constructorId) continue;
      const c = ensure(st.constructorId);
      if (st.team && !c.team) c.team = st.team;
      const pts = this.totals[st.tla];
      if (pts !== undefined) {
        if (!c.drivers.includes(st.tla)) c.drivers.push(st.tla);
        c.driverPoints += pts;
      }
    }
    for (const [constructorId, pit] of Object.entries(this.constructorPitTotals)) {
      ensure(constructorId).pitStopPoints += pit;
    }
    for (const c of map.values()) {
      c.drivers.sort();
      c.total = c.driverPoints + c.pitStopPoints;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  /** The full, ordered log of every scoring event (driver and constructor). */
  getEventLog(): ReadonlyArray<ScoringLogEntry> {
    return this.log;
  }

  /** The current session kind. */
  getSession(): SessionKind {
    return this.session;
  }

  /** Register a racing-number → TLA mapping (e.g. from a driver.list feed). */
  registerDriver(driverNumber: string, tla: string): void {
    this.numberToTla.set(String(driverNumber), tla.toUpperCase());
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  private onSessionStart(data: Record<string, unknown>): void {
    const type = String(data.sessionType ?? data.sessionName ?? "").toLowerCase();
    if (type.includes("qual") || type.includes("shootout")) this.session = "qualifying";
    else if (type.includes("sprint")) this.session = "sprint";
    else this.session = "race";
  }

  private onSessionComplete(data: Record<string, unknown>): void {
    const winner = this.refOf(data.winner);
    if (winner) {
      const st = this.observe(winner, 1);
      // The winner's finishing position is authoritative.
      if (st) st.lastPosition = 1;
    }
  }

  private onOvertake(data: Record<string, unknown>, at: string): void {
    const overtaking = this.refOf(data.overtakingDriver);
    const overtaken = this.refOf(data.overtakenDriver);
    const stA = overtaking ? this.observe(overtaking, this.posOf(data.overtakingDriver)) : undefined;
    if (overtaken) this.observe(overtaken, this.posOf(data.overtakenDriver));
    if (!stA || (this.session !== "race" && this.session !== "sprint")) return;

    const pts = this.rules.overtakePoints ?? 0;
    if (pts === 0 || !this.inRoster(stA)) return;
    stA.overtakes += 1;
    this.award("driver", stA.tla, pts, "OVERTAKE", at, {
      from: (data.overtakingDriver as Record<string, unknown> | undefined)?.prevPosition,
      to: (data.overtakingDriver as Record<string, unknown> | undefined)?.newPosition,
    });
  }

  private onOvertakeCount(data: Record<string, unknown>, at: string): void {
    const ref = this.refOf(data.driver);
    const st = ref ? this.observe(ref) : undefined;
    if (!st || (this.session !== "race" && this.session !== "sprint")) return;
    const pts = this.rules.overtakePoints ?? 0;
    if (pts === 0 || !this.inRoster(st)) return;

    const cumulative = Number(data.cumulativeOvertakes);
    if (!Number.isFinite(cumulative)) return;
    const delta = cumulative - st.overtakes;
    if (delta <= 0) return;
    st.overtakes = cumulative;
    this.award("driver", st.tla, pts * delta, "OVERTAKE", at, { count: delta, cumulative });
  }

  private onPositionsChanged(data: Record<string, unknown>): void {
    const ref = this.refOf(data.driver);
    if (!ref) return;
    const current = Number(data.currentPosition);
    const st = this.observe(ref, Number.isFinite(current) ? current : undefined);
    const grid = Number(data.gridPosition);
    if (st && Number.isFinite(grid)) st.gridPosition = grid;
  }

  private onLapSeriesPosition(data: Record<string, unknown>): void {
    const ref = this.refOf(data.driver);
    if (!ref) return;
    const pos = Number(data.newPosition);
    this.observe(ref, Number.isFinite(pos) ? pos : undefined);
  }

  private onFastestLap(data: Record<string, unknown>, at: string): void {
    const pts = this.rules.fastestLapPoints ?? 0;
    const ref = this.refOf(data.driver);
    const st = ref ? this.observe(ref) : undefined;
    if (!st || pts === 0 || !this.inRoster(st)) return;
    // Only the final fastest lap matters; re-score by replacing the prior award.
    this.removeAwards("driver", st.tla, "FASTEST_LAP");
    const lapTime = data.lapTime as { display?: string } | undefined;
    this.award("driver", st.tla, pts, "FASTEST_LAP", at, { lapTime: lapTime?.display });
  }

  private onRetirement(data: Record<string, unknown>, at: string): void {
    const ref = this.refOf(data.driver);
    if (!ref) return;
    const pos = Number(data.positionAtRetirement);
    const st = this.observe(ref, Number.isFinite(pos) ? pos : undefined);
    if (!st || st.dnfScored || !this.inRoster(st)) return;
    this.scoreDnf(st, at);
  }

  private onPitStop(data: Record<string, unknown>, at: string): void {
    // Constructor pit-stop scoring, keyed on the crew stationary time.
    const bands = this.rules.pitStopBands;
    const ref = this.refOf(data.driver);
    const st = ref ? this.observe(ref) : undefined;
    if (!st || !st.constructorId) return;
    const constructorId = st.constructorId;

    const ms = Number(data.stationaryMs ?? data.pitStopTimeMs);
    if (!Number.isFinite(ms) || ms <= 0) return;

    if (bands) {
      const band = bands.find((b) => ms >= b.minMs && ms < b.maxMs);
      if (band && band.points !== 0) {
        this.award("constructor", constructorId, band.points, "PIT_STOP_TIME", at, { stationaryMs: ms });
      }
    }

    // Fastest-stop-of-the-race bonus: move it when a new fastest stop is seen.
    if (this.rules.fastestPitStopBonus && ms < this.fastestPitMs) {
      if (this.fastestPitConstructor) {
        this.removeAwards("constructor", this.fastestPitConstructor, "FASTEST_PIT_STOP");
      }
      this.fastestPitMs = ms;
      this.fastestPitConstructor = constructorId;
      this.award("constructor", constructorId, this.rules.fastestPitStopBonus, "FASTEST_PIT_STOP", at, {
        stationaryMs: ms,
      });
    }

    // World-record bonus.
    if (
      this.rules.pitStopWorldRecordBonus &&
      this.rules.pitStopWorldRecordMs !== undefined &&
      ms < this.rules.pitStopWorldRecordMs
    ) {
      this.award("constructor", constructorId, this.rules.pitStopWorldRecordBonus, "PIT_STOP_WORLD_RECORD", at, {
        stationaryMs: ms,
      });
    }
  }

  private onLeadChange(data: Record<string, unknown>): void {
    const leader = this.refOf(data.newLeader);
    if (leader) this.observe(leader, 1);
    const prev = this.refOf(data.previousLeader);
    if (prev) this.observe(prev);
  }

  private onTopThreeUpdate(data: Record<string, unknown>): void {
    const drivers = data.drivers;
    if (!Array.isArray(drivers)) return;
    for (const entry of drivers as Array<Record<string, unknown>>) {
      const ref = this.refOf(entry.driver);
      const pos = Number(entry.position);
      if (ref) this.observe(ref, Number.isFinite(pos) ? pos : undefined);
    }
  }

  // ── Classification scoring ───────────────────────────────────────────────────

  private finalizeRace(at: string): void {
    for (const st of this.state.values()) {
      if (st.dnfScored || st.finishScored) continue;
      if (st.lastPosition === undefined || !this.inRoster(st)) continue;
      this.scoreFinish(st, st.lastPosition, at);
    }
  }

  private finalizeQualifying(at: string): void {
    const table = this.rules.qualifyingPositionPoints;
    if (!table) return;
    for (const st of this.state.values()) {
      if (st.qualiScored || st.lastPosition === undefined || !this.inRoster(st)) continue;
      st.qualiScored = true;
      const pts = table[st.lastPosition] ?? 0;
      if (pts !== 0) {
        this.award("driver", st.tla, pts, `QUALI_P${st.lastPosition}`, at, { position: st.lastPosition });
      }
    }
  }

  private scoreFinish(st: DriverState, position: number, at: string): void {
    if (st.finishScored) return;
    st.finishScored = true;

    const posTable = this.session === "sprint" ? this.rules.sprintPositionPoints : this.rules.racePositionPoints;
    const finishPts = posTable?.[position] ?? 0;
    if (finishPts !== 0) {
      this.award("driver", st.tla, finishPts, `P${position}_FINISH`, at, { position });
    }

    // Positions gained / lost, grid → finish.
    const start = this.gridPositions[st.tla] ?? st.gridPosition ?? st.inferredStart;
    if (start !== undefined) {
      const delta = start - position; // positive = gained
      if (delta > 0 && this.rules.positionGainedPoints) {
        this.award("driver", st.tla, this.rules.positionGainedPoints * delta, "POSITIONS_GAINED", at, {
          start,
          finish: position,
          gained: delta,
        });
      } else if (delta < 0 && this.rules.positionLostPoints) {
        this.award("driver", st.tla, this.rules.positionLostPoints * -delta, "POSITIONS_LOST", at, {
          start,
          finish: position,
          lost: -delta,
        });
      }
    }
  }

  private scoreDnf(st: DriverState, at: string): void {
    if (st.dnfScored || st.finishScored) return;
    st.dnfScored = true;
    const pts = this.session === "sprint" ? this.rules.sprintDnfPoints ?? 0 : this.rules.raceDnfPoints ?? 0;
    if (pts !== 0) {
      this.award("driver", st.tla, pts, "DNF", at, { session: this.session });
    }
  }

  /**
   * Beat-teammate bonus: within each constructor, the driver classified ahead
   * of their team-mate scores the bonus. A retired driver ranks behind any
   * classified team-mate; if both retired, neither scores.
   */
  private scoreBeatTeammate(session: SessionKind, at: string): void {
    const pts =
      session === "qualifying"
        ? this.rules.beatTeammateQualifyingPoints ?? 0
        : this.rules.beatTeammateRacePoints ?? 0;
    if (pts === 0) return;

    const byConstructor = new Map<string, DriverState[]>();
    for (const st of this.state.values()) {
      if (!st.constructorId) continue;
      const list = byConstructor.get(st.constructorId) ?? [];
      list.push(st);
      byConstructor.set(st.constructorId, list);
    }

    const effective = (st: DriverState): number =>
      st.dnfScored ? Number.POSITIVE_INFINITY : st.lastPosition ?? Number.POSITIVE_INFINITY;

    for (const teammates of byConstructor.values()) {
      if (teammates.length < 2) continue; // no team-mate to beat
      const ranked = [...teammates].sort((a, b) => effective(a) - effective(b));
      const best = ranked[0];
      const bestPos = effective(best);
      // Someone can only "beat" a team-mate if their own position is real and
      // strictly better than the next-best team-mate's.
      if (!Number.isFinite(bestPos) || effective(ranked[1]) <= bestPos) continue;
      if (best.beatTeammateScored || !this.inRoster(best)) continue;
      best.beatTeammateScored = true;
      const reason = session === "qualifying" ? "BEAT_TEAMMATE_QUALI" : "BEAT_TEAMMATE_RACE";
      this.award("driver", best.tla, pts, reason, at, { constructorId: best.constructorId });
    }
  }

  // ── Scoring primitives ────────────────────────────────────────────────────────

  private award(
    scope: ScoringScope,
    subject: string,
    points: number,
    reason: string,
    at: string,
    detail?: Record<string, unknown>
  ): void {
    const entry: ScoringLogEntry = { scope, driver: subject, points, reason, at, session: this.session, detail };
    this.log.push(entry);
    if (scope === "constructor") {
      this.constructorPitTotals[subject] = (this.constructorPitTotals[subject] ?? 0) + points;
    } else {
      this.totals[subject] = (this.totals[subject] ?? 0) + points;
    }
    this.emit(entry);
  }

  /** Reverse all prior awards for a subject+reason (used for "latest wins" bonuses). */
  private removeAwards(scope: ScoringScope, subject: string, reason: string): void {
    let removed = 0;
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log[i];
      if (e.scope === scope && e.driver === subject && e.reason === reason) {
        removed += e.points;
        this.log.splice(i, 1);
      }
    }
    if (removed === 0) return;
    if (scope === "constructor") {
      this.constructorPitTotals[subject] = (this.constructorPitTotals[subject] ?? 0) - removed;
    } else {
      this.totals[subject] = (this.totals[subject] ?? 0) - removed;
    }
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
    const key = tla.toUpperCase();
    let st = this.state.get(key);
    if (!st) {
      st = {
        tla: key,
        overtakes: 0,
        dnfScored: false,
        finishScored: false,
        qualiScored: false,
        beatTeammateScored: false,
      };
      this.state.set(key, st);
    }
    return st;
  }

  /**
   * Record a driver reference (identity + optional position) into state,
   * regardless of roster membership. Returns the driver's state, or undefined
   * when no TLA can be resolved.
   */
  private observe(ref: DriverRef, position?: number): DriverState | undefined {
    let tla = String(ref.tla ?? "").toUpperCase();
    const number = ref.number ? String(ref.number) : undefined;
    if (!tla && number) tla = this.numberToTla.get(number) ?? "";
    if (!tla) return undefined;

    const st = this.ensureState(tla);
    if (number) {
      st.number = number;
      this.numberToTla.set(number, tla);
    }
    if (ref.constructorId) st.constructorId = String(ref.constructorId);
    if (ref.team) st.team = String(ref.team);

    if (position !== undefined && Number.isFinite(position)) {
      if (st.inferredStart === undefined) st.inferredStart = position;
      st.lastPosition = position;
    }
    return st;
  }

  private inRoster(st: DriverState): boolean {
    if (this.roster === undefined) return true;
    if (this.roster.has(st.tla)) return true;
    return st.number !== undefined && this.roster.has(st.number.toUpperCase());
  }

  /** Extract a DriverRef from a nested event field, if present and well-formed. */
  private refOf(value: unknown): DriverRef | undefined {
    if (!value || typeof value !== "object") return undefined;
    const v = value as Record<string, unknown>;
    const tla = v.tla;
    const number = v.number;
    if ((typeof tla === "string" && tla.length > 0) || (number !== undefined && number !== null)) {
      return v as unknown as DriverRef;
    }
    return undefined;
  }

  /** Read a `newPosition` from an overtake participant object, if present. */
  private posOf(value: unknown): number | undefined {
    if (!value || typeof value !== "object") return undefined;
    const p = Number((value as Record<string, unknown>).newPosition);
    return Number.isFinite(p) ? p : undefined;
  }
}
