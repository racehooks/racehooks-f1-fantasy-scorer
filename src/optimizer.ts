/**
 * RosterOptimizer — given a pool of drivers with a price and a projected/
 * historical points figure, build a budget-compliant roster that maximises
 * projected points.
 *
 * The algorithm is a value-greedy heuristic with a final swap-improvement pass:
 *  1. Rank by points-per-dollar and fill the roster greedily.
 *  2. Repeatedly try replacing a picked driver with an unpicked one when the
 *     swap stays under budget and raises projected points.
 *
 * This is intentionally simple (no full knapsack ILP) so it runs instantly in
 * the browser and is easy to reason about — good enough for lineup suggestions,
 * not a guaranteed global optimum.
 */

export interface DriverCandidate {
  /** Driver three-letter abbreviation. */
  tla: string;
  /** Salary / price in the game's currency units (e.g. $M). */
  price: number;
  /** Projected or historical average fantasy points. */
  projectedPoints: number;
  /** Optional constructor/team tag (for future team-constraint use). */
  team?: string;
}

export interface OptimizerConstraints {
  /** Total salary budget. */
  budget: number;
  /** Number of drivers to select. */
  rosterSize: number;
}

export interface OptimizedRoster {
  drivers: DriverCandidate[];
  totalPrice: number;
  totalProjectedPoints: number;
  /** Budget remaining after the picks. */
  remainingBudget: number;
}

export const RosterOptimizer = {
  /**
   * Build the best roster the heuristic can find within the constraints.
   * Throws if the constraints cannot be satisfied (e.g. not enough affordable
   * drivers to fill the roster).
   */
  optimize(candidates: DriverCandidate[], constraints: OptimizerConstraints): OptimizedRoster {
    const { budget, rosterSize } = constraints;
    if (rosterSize <= 0) throw new Error("rosterSize must be > 0");
    if (candidates.length < rosterSize) {
      throw new Error(`Not enough candidates (${candidates.length}) to fill a roster of ${rosterSize}`);
    }

    // Feasibility check: the cheapest `rosterSize` drivers must fit the budget.
    const cheapestPossible = [...candidates]
      .sort((a, b) => a.price - b.price)
      .slice(0, rosterSize)
      .reduce((s, d) => s + d.price, 0);
    if (cheapestPossible > budget) {
      throw new Error(`Cannot build a roster of ${rosterSize} within budget ${budget}`);
    }

    // 1. Greedy fill by value (points per dollar), but keep enough budget in
    //    reserve to afford the cheapest drivers needed to fill the remaining
    //    slots. This prevents the greedy pass from spending so much on a few
    //    premium picks that the roster can no longer be completed.
    const cheapPrices = [...candidates].map((c) => c.price).sort((a, b) => a - b);
    /** Minimum cost to fill `n` more slots from the n cheapest drivers overall. */
    const minCostForSlots = (n: number) => cheapPrices.slice(0, n).reduce((s, p) => s + p, 0);

    const byValue = [...candidates].sort(
      (a, b) => b.projectedPoints / Math.max(b.price, 1e-9) - a.projectedPoints / Math.max(a.price, 1e-9)
    );

    const picked: DriverCandidate[] = [];
    const pickedTlas = new Set<string>();
    let spent = 0;
    for (const c of byValue) {
      if (picked.length >= rosterSize) break;
      if (pickedTlas.has(c.tla)) continue;
      const slotsAfter = rosterSize - picked.length - 1;
      // Reserve the cheapest-possible cost for the slots that would remain.
      if (spent + c.price + minCostForSlots(slotsAfter) <= budget) {
        picked.push(c);
        pickedTlas.add(c.tla);
        spent += c.price;
      }
    }

    // Backfill any remaining slots with the cheapest affordable drivers.
    if (picked.length < rosterSize) {
      const cheapest = candidates.filter((c) => !pickedTlas.has(c.tla)).sort((a, b) => a.price - b.price);
      for (const c of cheapest) {
        if (picked.length >= rosterSize) break;
        if (spent + c.price <= budget) {
          picked.push(c);
          pickedTlas.add(c.tla);
          spent += c.price;
        }
      }
    }

    if (picked.length < rosterSize) {
      throw new Error(`Cannot build a roster of ${rosterSize} within budget ${budget}`);
    }

    // 2. Swap-improvement pass: try replacing each picked driver with any
    //    unpicked driver when it stays within budget and raises points.
    let improved = true;
    while (improved) {
      improved = false;
      const pickedSet = new Set(picked.map((p) => p.tla));
      const bench = candidates.filter((c) => !pickedSet.has(c.tla));

      for (let i = 0; i < picked.length; i++) {
        const out = picked[i];
        for (const inn of bench) {
          const newSpent = spent - out.price + inn.price;
          if (newSpent <= budget && inn.projectedPoints > out.projectedPoints) {
            picked[i] = inn;
            spent = newSpent;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }

    const totalProjectedPoints = picked.reduce((s, d) => s + d.projectedPoints, 0);
    return {
      drivers: picked.sort((a, b) => b.projectedPoints - a.projectedPoints),
      totalPrice: spent,
      totalProjectedPoints,
      remainingBudget: budget - spent,
    };
  },
};
