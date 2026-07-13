import { OfficialF1ScoringRules, DFSScoringRules, ScoringRulesValidator } from "../src/rules";
import type { ScoringRules } from "../src/rules";

describe("OfficialF1ScoringRules — exact point values", () => {
  it("race finish points match the official 25-18-15-... table", () => {
    const t = OfficialF1ScoringRules.racePositionPoints;
    expect(t[1]).toBe(25);
    expect(t[2]).toBe(18);
    expect(t[3]).toBe(15);
    expect(t[4]).toBe(12);
    expect(t[5]).toBe(10);
    expect(t[6]).toBe(8);
    expect(t[7]).toBe(6);
    expect(t[8]).toBe(4);
    expect(t[9]).toBe(2);
    expect(t[10]).toBe(1);
    expect(t[11]).toBe(0);
  });

  it("qualifying points run 10 down to 1 (P1..P10)", () => {
    const q = OfficialF1ScoringRules.qualifyingPositionPoints!;
    expect(q[1]).toBe(10);
    expect(q[10]).toBe(1);
    expect(q[11]).toBe(0);
  });

  it("sprint finish points run 8 down to 1 (P1..P8)", () => {
    const s = OfficialF1ScoringRules.sprintPositionPoints!;
    expect(s[1]).toBe(8);
    expect(s[8]).toBe(1);
    expect(s[9]).toBe(0);
  });

  it("penalties and bonuses match the documented values", () => {
    expect(OfficialF1ScoringRules.positionGainedPoints).toBe(1);
    expect(OfficialF1ScoringRules.positionLostPoints).toBe(-1);
    expect(OfficialF1ScoringRules.overtakePoints).toBe(1);
    expect(OfficialF1ScoringRules.driverOfTheDayPoints).toBe(10);
    expect(OfficialF1ScoringRules.raceDnfPoints).toBe(-20);
    expect(OfficialF1ScoringRules.sprintDnfPoints).toBe(-10); // 2026 reduction
    expect(OfficialF1ScoringRules.beatTeammateRacePoints).toBe(3);
    expect(OfficialF1ScoringRules.beatTeammateQualifyingPoints).toBe(2);
    // Official game has NO fastest-lap bonus.
    expect(OfficialF1ScoringRules.fastestLapPoints).toBeUndefined();
  });

  it("pit-stop bands cover the documented thresholds", () => {
    const inBand = (ms: number) =>
      OfficialF1ScoringRules.pitStopBands!.find((b) => ms >= b.minMs && ms < b.maxMs)!.points;
    expect(inBand(1990)).toBe(20);
    expect(inBand(2100)).toBe(10);
    expect(inBand(2300)).toBe(5);
    expect(inBand(2700)).toBe(2);
    expect(inBand(3500)).toBe(0);
  });
});

describe("DFSScoringRules", () => {
  it("keeps a fastest-lap bonus and a steeper finish curve", () => {
    expect(DFSScoringRules.fastestLapPoints).toBe(5);
    expect(DFSScoringRules.racePositionPoints[1]).toBe(45);
    expect(DFSScoringRules.positionGainedPoints).toBe(3);
  });

  it("imposes no DNF penalty", () => {
    expect(DFSScoringRules.raceDnfPoints).toBe(0);
  });
});

describe("ScoringRulesValidator", () => {
  it("accepts the shipped rule sets", () => {
    expect(ScoringRulesValidator.validate(OfficialF1ScoringRules).valid).toBe(true);
    expect(ScoringRulesValidator.validate(DFSScoringRules).valid).toBe(true);
  });

  it("rejects rules missing a race table", () => {
    const bad = { name: "broken" } as unknown as ScoringRules;
    const result = ScoringRulesValidator.validate(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/racePositionPoints/);
  });

  it("warns when a penalty is positive", () => {
    const rules: ScoringRules = {
      name: "weird",
      racePositionPoints: [0, 25, 18],
      raceDnfPoints: 20,
    };
    const result = ScoringRulesValidator.validate(rules);
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/raceDnfPoints is positive/);
  });

  it("warns when P1 < P2 (inverted table)", () => {
    const rules: ScoringRules = { name: "inverted", racePositionPoints: [0, 5, 25] };
    expect(ScoringRulesValidator.validate(rules).warnings.join(" ")).toMatch(/inverted/);
  });

  it("assertValid throws on invalid rules", () => {
    expect(() => ScoringRulesValidator.assertValid({ name: "x" } as unknown as ScoringRules)).toThrow();
  });
});
