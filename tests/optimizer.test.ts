import { RosterOptimizer } from "../src";
import type { DriverCandidate } from "../src";

const pool: DriverCandidate[] = [
  { tla: "VER", price: 30, projectedPoints: 95 },
  { tla: "NOR", price: 28, projectedPoints: 90 },
  { tla: "LEC", price: 24, projectedPoints: 78 },
  { tla: "HAM", price: 22, projectedPoints: 70 },
  { tla: "RUS", price: 20, projectedPoints: 65 },
  { tla: "PIA", price: 18, projectedPoints: 60 },
  { tla: "ALO", price: 14, projectedPoints: 45 },
  { tla: "STR", price: 8, projectedPoints: 25 },
  { tla: "OCO", price: 7, projectedPoints: 22 },
  { tla: "BOT", price: 5, projectedPoints: 12 },
];

describe("RosterOptimizer", () => {
  it("returns a budget-compliant roster of the requested size", () => {
    const result = RosterOptimizer.optimize(pool, { budget: 100, rosterSize: 5 });
    expect(result.drivers).toHaveLength(5);
    expect(result.totalPrice).toBeLessThanOrEqual(100);
    expect(result.remainingBudget).toBe(100 - result.totalPrice);
    // No duplicate drivers.
    const tlas = new Set(result.drivers.map((d) => d.tla));
    expect(tlas.size).toBe(5);
  });

  it("beats a naive cheapest-five roster on projected points", () => {
    const result = RosterOptimizer.optimize(pool, { budget: 100, rosterSize: 5 });
    const cheapestFive = [...pool].sort((a, b) => a.price - b.price).slice(0, 5);
    const cheapPoints = cheapestFive.reduce((s, d) => s + d.projectedPoints, 0);
    expect(result.totalProjectedPoints).toBeGreaterThan(cheapPoints);
  });

  it("never exceeds the budget even with a tight cap", () => {
    const result = RosterOptimizer.optimize(pool, { budget: 60, rosterSize: 5 });
    expect(result.totalPrice).toBeLessThanOrEqual(60);
    expect(result.drivers).toHaveLength(5);
  });

  it("throws when the roster cannot be filled within budget", () => {
    expect(() => RosterOptimizer.optimize(pool, { budget: 20, rosterSize: 5 })).toThrow();
  });

  it("throws when there are fewer candidates than the roster size", () => {
    expect(() => RosterOptimizer.optimize(pool.slice(0, 3), { budget: 1000, rosterSize: 5 })).toThrow();
  });

  it("returns drivers sorted by projected points (descending)", () => {
    const result = RosterOptimizer.optimize(pool, { budget: 120, rosterSize: 5 });
    for (let i = 1; i < result.drivers.length; i++) {
      expect(result.drivers[i - 1].projectedPoints).toBeGreaterThanOrEqual(result.drivers[i].projectedPoints);
    }
  });
});
