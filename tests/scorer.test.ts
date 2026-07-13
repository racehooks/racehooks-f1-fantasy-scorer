import { FantasyScorer, OfficialF1ScoringRules, DFSScoringRules } from "../src";
import type { RaceEventPayload, DriverRef, LiveContext } from "../src";
import monaco from "../fixtures/monaco-race-events.json";

/** Build a minimal full DriverRef for a driver code. */
const REFS: Record<string, DriverRef> = {
  VER: { driverId: "max_verstappen", constructorId: "red-bull", number: "1", tla: "VER", name: "Max Verstappen", team: "Red Bull Racing" },
  NOR: { driverId: "lando_norris", constructorId: "mclaren", number: "4", tla: "NOR", name: "Lando Norris", team: "McLaren" },
  LEC: { driverId: "charles_leclerc", constructorId: "ferrari", number: "16", tla: "LEC", name: "Charles Leclerc", team: "Ferrari" },
  HAM: { driverId: "lewis_hamilton", constructorId: "ferrari", number: "44", tla: "HAM", name: "Lewis Hamilton", team: "Ferrari" },
  RUS: { driverId: "george_russell", constructorId: "mercedes", number: "63", tla: "RUS", name: "George Russell", team: "Mercedes" },
};

/** Construct an events.race payload. */
function re(event: string, data: Record<string, unknown>, utc = "2026-01-01T00:00:00Z"): RaceEventPayload {
  return { feed: "events.race", event, utc, data };
}

describe("FantasyScorer — full Monaco race fixture (Official rules)", () => {
  function runMonaco() {
    const scorer = new FantasyScorer({
      rules: OfficialF1ScoringRules,
      roster: ["VER", "NOR", "LEC", "HAM", "RUS"],
      gridPositions: monaco.monacoGrid,
    });
    for (const ev of monaco.events as RaceEventPayload[]) {
      scorer.ingest(ev);
    }
    return scorer;
  }

  it("routes on the real events.race discriminator and scores non-zero, correct totals", () => {
    const scores = runMonaco().getScores();
    // VER: P1 (25). Grid 1 → finish 1 = no positions delta. = 25
    expect(scores.VER).toBe(25);
    // LEC: P2 (18) + gained 4->2 (+2) + 2 overtakes (+2) + beat teammate HAM (+3) = 25
    expect(scores.LEC).toBe(25);
    // NOR: P3 (15) + lost 2->3 (-1) = 14 (pit points go to the constructor, not NOR)
    expect(scores.NOR).toBe(14);
    // HAM: P5 (10) + gained 7->5 (+2) + 2 overtakes (+2) = 14 (lost teammate battle to LEC)
    expect(scores.HAM).toBe(14);
    // RUS: DNF (-20)
    expect(scores.RUS).toBe(-20);
  });

  it("does not award a fastest-lap bonus under official rules", () => {
    const log = runMonaco().getEventLog();
    expect(log.some((e) => e.reason === "FASTEST_LAP")).toBe(false);
  });

  it("adds Driver of the Day only as an external input (not from the feed)", () => {
    const scorer = runMonaco();
    // No fabricated driver_of_the_day event exists in the feed → no DotD yet.
    expect(scorer.getEventLog().some((e) => e.reason === "DRIVER_OF_THE_DAY")).toBe(false);
    scorer.setDriverOfTheDay("LEC");
    expect(scorer.getScore("LEC")).toBe(35); // 25 + 10
    expect(scorer.getEventLog().some((e) => e.reason === "DRIVER_OF_THE_DAY" && e.driver === "LEC")).toBe(true);
  });

  it("aggregates constructor scores: driver points + constructor pit points", () => {
    const scorer = runMonaco();
    scorer.setDriverOfTheDay("LEC");
    const byId = Object.fromEntries(scorer.getConstructorScores().map((c) => [c.constructorId, c]));

    // Ferrari: LEC (25 + 10 DotD) + HAM (14) = 49 driver points, no pit event.
    expect(byId["ferrari"].driverPoints).toBe(49);
    expect(byId["ferrari"].pitStopPoints).toBe(0);
    expect(byId["ferrari"].total).toBe(49);
    expect(byId["ferrari"].drivers).toEqual(["HAM", "LEC"]);

    // McLaren: NOR 14 driver points + pit (1950ms → 20 band + 5 fastest-of-race) = 25 → 39.
    expect(byId["mclaren"].driverPoints).toBe(14);
    expect(byId["mclaren"].pitStopPoints).toBe(25);
    expect(byId["mclaren"].total).toBe(39);

    // Red Bull: VER 25 + pit (2150ms → 10 band) = 35.
    expect(byId["red-bull"].driverPoints).toBe(25);
    expect(byId["red-bull"].pitStopPoints).toBe(10);
    expect(byId["red-bull"].total).toBe(35);
  });

  it("captures every scoring event in chronological order", () => {
    const log = runMonaco().getEventLog();
    for (let i = 1; i < log.length; i++) {
      expect(new Date(log[i].at).getTime()).toBeGreaterThanOrEqual(new Date(log[i - 1].at).getTime());
    }
    expect(log.some((e) => e.driver === "VER" && e.reason === "P1_FINISH" && e.points === 25)).toBe(true);
    expect(log.some((e) => e.driver === "LEC" && e.reason === "BEAT_TEAMMATE_RACE" && e.points === 3)).toBe(true);
    expect(log.some((e) => e.driver === "RUS" && e.reason === "DNF" && e.points === -20)).toBe(true);
  });

  it("moves the constructor fastest-pit bonus to the genuinely fastest stop", () => {
    const log = runMonaco().getEventLog();
    const fastest = log.filter((e) => e.reason === "FASTEST_PIT_STOP");
    // VER's transient fastest award was removed when McLaren posted a quicker stop.
    expect(fastest).toHaveLength(1);
    expect(fastest[0].scope).toBe("constructor");
    expect(fastest[0].driver).toBe("mclaren");
  });
});

describe("FantasyScorer — nested DriverRef attribution", () => {
  it("reads overtakingDriver.tla, never a flat data.tla", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["LEC"] });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    scorer.processEvent(
      re("overtake", {
        overtakingDriver: { ...REFS.LEC, prevPosition: 3, newPosition: 2 },
        overtakenDriver: { ...REFS.HAM, prevPosition: 2, newPosition: 3 },
      })
    );
    // LEC gets the overtake point; HAM (the overtaken driver) does not.
    expect(scorer.getScore("LEC")).toBe(1);
    expect(scorer.getScore("HAM")).toBe(0);
  });

  it("credits overtake.count cumulatively without double-counting discrete overtakes", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["HAM"] });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    scorer.processEvent(re("overtake", { overtakingDriver: { ...REFS.HAM, prevPosition: 8, newPosition: 7 } }));
    // Cumulative counter reports 3 total overtakes → only 2 more should be credited.
    scorer.processEvent(re("overtake.count", { driver: REFS.HAM, cumulativeOvertakes: 3 }));
    expect(scorer.getScore("HAM")).toBe(3);
  });
});

describe("FantasyScorer — roster filtering & boost", () => {
  it("observes but does not score drivers outside the roster", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["VER"] });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    scorer.processEvent(re("positions.gained", { driver: REFS.VER, gridPosition: 3, currentPosition: 1, positionsGained: 2 }));
    scorer.processEvent(re("positions.lost", { driver: REFS.HAM, gridPosition: 1, currentPosition: 2, positionsGained: -1 }));
    scorer.ingest(re("session.complete", { sessionType: "Race", winner: REFS.VER }));
    const scores = scorer.getScores();
    expect(scores.VER).toBe(27); // P1 (25) + gained 3->1 (+2)
    expect(scores.HAM).toBeUndefined();
  });

  it("applies a turbo-driver boost multiplier to the total", () => {
    const scorer = new FantasyScorer({
      rules: OfficialF1ScoringRules,
      roster: ["VER", "NOR"],
      boost: { driver: "VER", multiplier: 2 },
    });
    scorer.ingest(re("session.complete", { sessionType: "Race", winner: REFS.VER })); // VER P1 → 25 → 50
    expect(scorer.getScore("VER")).toBe(50);
  });
});

describe("FantasyScorer — DNF handling", () => {
  it("scores a race DNF at -20 and a sprint DNF at -10", () => {
    const race = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["HAM"] });
    race.processEvent(re("session.start", { sessionType: "Race" }));
    race.processEvent(re("retirement", { driver: REFS.HAM, positionAtRetirement: 5, pitsCompleted: 1, cause: "accident", causeRawMessage: "" }));
    expect(race.getScore("HAM")).toBe(-20);

    const sprint = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["HAM"] });
    sprint.processEvent(re("session.start", { sessionType: "Sprint" }));
    sprint.processEvent(re("retirement", { driver: REFS.HAM, positionAtRetirement: 5, pitsCompleted: 1, cause: "accident", causeRawMessage: "" }));
    expect(sprint.getScore("HAM")).toBe(-10);
  });

  it("a driver who retires gets only the DNF penalty (no finish points)", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["LEC"], gridPositions: { LEC: 1 } });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    scorer.processEvent(re("retirement", { driver: REFS.LEC, positionAtRetirement: 1, pitsCompleted: 0, cause: "mechanical", causeRawMessage: "" }));
    scorer.finalize();
    expect(scorer.getScore("LEC")).toBe(-20);
    expect(scorer.getEventLog().some((e) => e.reason.endsWith("_FINISH"))).toBe(false);
  });

  it("derives a retirement from a LiveContext row (status Retired)", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["RUS"] });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    const ctx: LiveContext = {
      active: true,
      sessionName: "Grand Prix",
      sessionType: "Race",
      currentLap: 40,
      totalLaps: 78,
      flag: "green",
      updatedAt: Date.now(),
      drivers: [
        { pos: 5, num: "63", tla: "RUS", name: "George Russell", team: "Mercedes", gap: "", interval: "", lastLap: "", compound: "MEDIUM", tyreAge: 12, pits: 1, status: "Retired" },
      ],
    };
    scorer.processLiveUpdate(ctx);
    expect(scorer.getScore("RUS")).toBe(-20);
  });
});

describe("FantasyScorer — beat teammate", () => {
  it("awards the beat-teammate bonus to whichever teammate finishes ahead", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["LEC", "HAM"], gridPositions: { LEC: 4, HAM: 3 } });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    scorer.processEvent(re("positions.gained", { driver: REFS.LEC, gridPosition: 4, currentPosition: 2, positionsGained: 2 }));
    scorer.processEvent(re("positions.lost", { driver: REFS.HAM, gridPosition: 3, currentPosition: 6, positionsGained: -3 }));
    scorer.ingest(re("session.complete", { sessionType: "Race" }));
    // LEC finished P2, HAM P6 → LEC beats teammate (+3), HAM does not.
    const log = scorer.getEventLog();
    expect(log.filter((e) => e.reason === "BEAT_TEAMMATE_RACE").map((e) => e.driver)).toEqual(["LEC"]);
  });
});

describe("FantasyScorer — qualifying scoring", () => {
  it("awards qualifying position points from final positions", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["VER", "HAM"] });
    scorer.processEvent(re("session.start", { sessionType: "Qualifying" }));
    scorer.processEvent(re("positions.gained", { driver: REFS.VER, gridPosition: 1, currentPosition: 1, positionsGained: 0 }));
    scorer.processEvent(re("positions.gained", { driver: REFS.HAM, gridPosition: 3, currentPosition: 3, positionsGained: 0 }));
    scorer.finalize();
    expect(scorer.getScore("VER")).toBe(10); // pole
    expect(scorer.getScore("HAM")).toBe(8); // P3
  });
});

describe("FantasyScorer — DFS rules", () => {
  it("awards the DFS fastest-lap bonus and the steeper place differential", () => {
    const scorer = new FantasyScorer({ rules: DFSScoringRules, roster: ["NOR"], gridPositions: { NOR: 5 } });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    scorer.processEvent(re("fastest.lap", { driver: REFS.NOR, lapTime: { display: "1:12.000", ms: 72000 } }));
    scorer.processEvent(re("positions.gained", { driver: REFS.NOR, gridPosition: 5, currentPosition: 1, positionsGained: 4 }));
    scorer.ingest(re("session.complete", { sessionType: "Race" }));
    // P1 (45) + gained 5->1 (4 * 3 = 12) + fastest lap (5) = 62
    expect(scorer.getScore("NOR")).toBe(62);
  });
});

describe("FantasyScorer — scoreUpdate listener", () => {
  it("fires on each scoring event with a fresh snapshot", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["VER"] });
    const seen: number[] = [];
    const unsub = scorer.on("scoreUpdate", (scores) => seen.push(scores.VER));
    scorer.ingest(re("session.complete", { sessionType: "Race", winner: REFS.VER }));
    expect(seen).toEqual([25]);
    unsub();
    scorer.setDriverOfTheDay("VER");
    // After unsubscribe, no further callbacks, but the score still updated.
    expect(seen).toEqual([25]);
    expect(scorer.getScore("VER")).toBe(35);
  });
});
