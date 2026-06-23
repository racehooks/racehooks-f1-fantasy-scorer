import { FantasyScorer, OfficialF1ScoringRules, DFSScoringRules } from "../src";
import type { RaceEventPayload } from "../src";
import monaco from "../fixtures/monaco-race-events.json";

function re(event: string, data: Record<string, unknown>, utc = "2026-01-01T00:00:00Z"): RaceEventPayload {
  return { feed: "raceevent", event, utc, data };
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

  it("produces the exact expected point totals", () => {
    const scores = runMonaco().getScores();
    // VER: P1 (25) + pit 2150ms band (10) = 35
    expect(scores.VER).toBe(35);
    // LEC: P2 (18) + gained 4->2 (+2) + 2 overtakes (+2) + DotD (+10) = 32
    expect(scores.LEC).toBe(32);
    // NOR: P3 (15) + lost 2->3 (-1) + pit 1950ms band (20) + fastest pit (+5) = 39
    expect(scores.NOR).toBe(39);
    // HAM: P5 (10) + gained 7->5 (+2) + 2 overtakes (+2) = 14
    expect(scores.HAM).toBe(14);
    // RUS: DNF (-20)
    expect(scores.RUS).toBe(-20);
  });

  it("does not award a fastest-lap bonus under official rules", () => {
    const log = runMonaco().getEventLog();
    expect(log.some((e) => e.reason === "FASTEST_LAP")).toBe(false);
  });

  it("captures every scoring event in chronological order", () => {
    const log = runMonaco().getEventLog();
    // Each timestamp should be >= the previous (events processed in feed order).
    for (let i = 1; i < log.length; i++) {
      expect(new Date(log[i].at).getTime()).toBeGreaterThanOrEqual(new Date(log[i - 1].at).getTime());
    }
    // Spot-check a few key entries exist.
    expect(log.some((e) => e.driver === "VER" && e.reason === "P1_FINISH" && e.points === 25)).toBe(true);
    expect(log.some((e) => e.driver === "LEC" && e.reason === "DRIVER_OF_THE_DAY" && e.points === 10)).toBe(true);
    expect(log.some((e) => e.driver === "RUS" && e.reason === "DNF" && e.points === -20)).toBe(true);
  });

  it("the fastest-pit bonus moves to the genuinely fastest stop", () => {
    const log = runMonaco().getEventLog();
    const fastest = log.filter((e) => e.reason === "FASTEST_PIT_STOP");
    // VER's transient fastest award was removed when NOR posted a quicker stop.
    expect(fastest).toHaveLength(1);
    expect(fastest[0].driver).toBe("NOR");
  });
});

describe("FantasyScorer — roster filtering & boost", () => {
  it("ignores drivers outside the roster", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["VER"] });
    scorer.processEvent(re("driver_finished", { tla: "VER", position: 1 }));
    scorer.processEvent(re("driver_finished", { tla: "HAM", position: 2 }));
    const scores = scorer.getScores();
    expect(scores.VER).toBe(25);
    expect(scores.HAM).toBeUndefined();
  });

  it("applies a turbo-driver boost multiplier to the total", () => {
    const scorer = new FantasyScorer({
      rules: OfficialF1ScoringRules,
      roster: ["VER", "NOR"],
      boost: { driver: "VER", multiplier: 2 },
    });
    scorer.processEvent(re("driver_finished", { tla: "VER", position: 1 })); // 25 -> 50
    scorer.processEvent(re("driver_finished", { tla: "NOR", position: 2 })); // 18
    expect(scorer.getScore("VER")).toBe(50);
    expect(scorer.getScore("NOR")).toBe(18);
  });
});

describe("FantasyScorer — DNF timing & last-lap edge cases", () => {
  it("scores a DNF the same regardless of lap, but differently for sprint", () => {
    const race = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["HAM"] });
    race.processEvent(re("session.start", { sessionType: "Race" }));
    race.processEvent(re("retirement", { tla: "HAM", positionAtRetirement: 5 }));
    expect(race.getScore("HAM")).toBe(-20);

    const sprint = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["HAM"] });
    sprint.processEvent(re("session.start", { sessionType: "Sprint" }));
    sprint.processEvent(re("retirement", { tla: "HAM", positionAtRetirement: 5 }));
    expect(sprint.getScore("HAM")).toBe(-10);
  });

  it("a driver who starts then retires gets only the DNF penalty (no finish points)", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["LEC"], gridPositions: { LEC: 1 } });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    scorer.processTimingUpdate({
      drivers: [{ driverId: "leclerc-charles", constructorId: "ferrari", number: "16", tla: "LEC", name: "Charles Leclerc", team: "Scuderia Ferrari", Position: 1, Status: 1 }],
    });
    scorer.registerDriver("16", "LEC");
    scorer.processTimingUpdate({
      drivers: [{ driverId: "leclerc-charles", constructorId: "ferrari", number: "16", tla: "LEC", name: "Charles Leclerc", team: "Scuderia Ferrari", Position: 1, Status: 3 }],
    });
    scorer.finalize();
    expect(scorer.getScore("LEC")).toBe(-20);
    const log = scorer.getEventLog();
    expect(log.some((e) => e.reason.endsWith("_FINISH"))).toBe(false);
  });

  it("registerDriver() pre-registration is honoured when timingdata arrives with no tla", () => {
    // Regression: processTimingUpdate must consult numberToTla when d.tla is absent,
    // so a registerDriver() call before timing arrives is not silently discarded.
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["VER"] });
    scorer.registerDriver("1", "VER");
    // Timing entry has no tla field — simulates a partial delta from a future feed shape.
    scorer.processTimingUpdate({
      drivers: [{ driverId: "verstappen-max", constructorId: "red-bull-racing", number: "1", tla: "", name: "Max Verstappen", team: "Red Bull Racing", Position: 1 }],
    });
    scorer.processEvent(re("driver_finished", { tla: "VER", position: 1 }));
    // VER should have finish points; if the pre-registration was lost the driver
    // would have been skipped in processTimingUpdate and finalize would miss the start pos.
    expect(scorer.getScore("VER")).toBeGreaterThan(0);
    expect(scorer.getScore("VER")).toBe(25); // P1 finish
  });

  it("handles a position change on the last lap via driver_finished", () => {
    const scorer = new FantasyScorer({
      rules: OfficialF1ScoringRules,
      roster: ["NOR"],
      gridPositions: { NOR: 3 },
    });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    // NOR overtakes into P1 on the final lap, then is classified P1.
    scorer.processEvent(re("overtake", { tla: "NOR", fromPosition: 2, toPosition: 1 }));
    scorer.processEvent(re("driver_finished", { tla: "NOR", position: 1 }));
    // P1 (25) + gained 3->1 (+2) + 1 overtake (+1) = 28
    expect(scorer.getScore("NOR")).toBe(28);
  });
});

describe("FantasyScorer — qualifying scoring", () => {
  it("awards qualifying position points from final timing", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["1", "44"] });
    scorer.processEvent(re("session.start", { sessionType: "Qualifying" }));
    // roster uses driver numbers — scorer falls back to number key when TLA not in roster
    scorer.processTimingUpdate({
      drivers: [
        { driverId: "verstappen-max", constructorId: "red-bull-racing", number: "1", tla: "VER", name: "Max Verstappen", team: "Red Bull Racing", Position: 1 },
        { driverId: "hamilton-lewis", constructorId: "mercedes", number: "44", tla: "HAM", name: "Lewis Hamilton", team: "Mercedes", Position: 3 },
      ],
    });
    scorer.finalize();
    expect(scorer.getScore("1")).toBe(10); // pole
    expect(scorer.getScore("44")).toBe(8); // P3
  });
});

describe("FantasyScorer — DFS rules", () => {
  it("awards the DFS fastest-lap bonus and steeper differential", () => {
    const scorer = new FantasyScorer({ rules: DFSScoringRules, roster: ["NOR"], gridPositions: { NOR: 5 } });
    scorer.processEvent(re("session.start", { sessionType: "Race" }));
    scorer.processEvent(re("fastest_lap", { tla: "NOR", lapTime: "1:12.000" }));
    scorer.processEvent(re("driver_finished", { tla: "NOR", position: 1 }));
    // P1 (45) + gained 5->1 (4 * 3 = 12) + fastest lap (5) = 62
    expect(scorer.getScore("NOR")).toBe(62);
  });
});

describe("FantasyScorer — scoreUpdate listener", () => {
  it("fires on each scoring event with a fresh snapshot", () => {
    const scorer = new FantasyScorer({ rules: OfficialF1ScoringRules, roster: ["VER"] });
    const seen: number[] = [];
    const unsub = scorer.on("scoreUpdate", (scores) => seen.push(scores.VER));
    scorer.processEvent(re("driver_finished", { tla: "VER", position: 1 }));
    expect(seen).toEqual([25]);
    unsub();
    scorer.processEvent(re("driver_of_the_day", { tla: "VER" }));
    // After unsubscribe, no further callbacks.
    expect(seen).toEqual([25]);
    // But the score still updated.
    expect(scorer.getScore("VER")).toBe(35);
  });
});
