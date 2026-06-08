import type { ScoringRules } from "./types";

/** Result of validating a {@link ScoringRules} object. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * ScoringRulesValidator — checks that a (possibly user-supplied) rules object
 * is complete and internally consistent before it is handed to the scorer.
 *
 * Errors block scoring; warnings are surfaced but non-fatal.
 */
export const ScoringRulesValidator = {
  validate(rules: ScoringRules): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!rules.name || typeof rules.name !== "string") {
      errors.push("rules.name is required and must be a string");
    }

    if (!Array.isArray(rules.racePositionPoints) || rules.racePositionPoints.length < 2) {
      errors.push("rules.racePositionPoints must be an array covering at least P1");
    } else {
      if (!rules.racePositionPoints.every((n) => typeof n === "number" && Number.isFinite(n))) {
        errors.push("rules.racePositionPoints must contain only finite numbers");
      }
      // P1 should out-score P2 — catches an inverted table.
      if (rules.racePositionPoints.length > 2 && rules.racePositionPoints[1] < rules.racePositionPoints[2]) {
        warnings.push("racePositionPoints: P1 scores fewer points than P2 — table may be inverted");
      }
    }

    for (const key of ["sprintPositionPoints", "qualifyingPositionPoints"] as const) {
      const table = rules[key];
      if (table !== undefined && !Array.isArray(table)) {
        errors.push(`rules.${key} must be an array when present`);
      }
    }

    // Penalties should be non-positive — a positive "penalty" is almost always a bug.
    for (const key of [
      "raceDnfPoints",
      "sprintDnfPoints",
      "raceDisqualificationPoints",
      "qualifyingDisqualificationPoints",
      "positionLostPoints",
    ] as const) {
      const v = rules[key];
      if (v !== undefined && v > 0) {
        warnings.push(`rules.${key} is positive (${v}); penalties are normally <= 0`);
      }
    }

    // Pit-stop bands should be contiguous and ordered.
    if (rules.pitStopBands) {
      for (const band of rules.pitStopBands) {
        if (band.minMs >= band.maxMs) {
          errors.push(`pitStopBands: band [${band.minMs}, ${band.maxMs}) has minMs >= maxMs`);
        }
      }
    }

    if (rules.pitStopWorldRecordBonus !== undefined && rules.pitStopWorldRecordMs === undefined) {
      warnings.push("pitStopWorldRecordBonus set without pitStopWorldRecordMs — world-record bonus will never fire");
    }

    return { valid: errors.length === 0, errors, warnings };
  },

  /** Convenience: throws with a combined message if the rules are invalid. */
  assertValid(rules: ScoringRules): void {
    const result = this.validate(rules);
    if (!result.valid) {
      throw new Error(`Invalid scoring rules "${rules.name}":\n  - ${result.errors.join("\n  - ")}`);
    }
  },
};
