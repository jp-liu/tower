export interface TurnTimeBudgetSnapshot {
  turns: number;
  elapsedMs: number;
}

export interface TurnTimeBudgetLimits {
  maxTurns?: number;
  maxDurationMs?: number;
}

export type TurnTimeBudgetVerdict =
  | { ok: true }
  | { ok: false; reason: "max_turns" | "max_duration"; detail: string };

export interface BudgetGuard {
  check(snapshot: TurnTimeBudgetSnapshot): TurnTimeBudgetVerdict;
}

/** CLI providers do not expose stable token cost, so turns and elapsed time are the base guard. */
export class TurnTimeBudgetGuard implements BudgetGuard {
  constructor(private readonly limits: TurnTimeBudgetLimits) {}

  check(snapshot: TurnTimeBudgetSnapshot): TurnTimeBudgetVerdict {
    const { maxTurns, maxDurationMs } = this.limits;
    if (maxTurns !== undefined && snapshot.turns >= maxTurns) {
      return {
        ok: false,
        reason: "max_turns",
        detail: `Used ${snapshot.turns} provider turns; limit is ${maxTurns}`,
      };
    }
    if (maxDurationMs !== undefined && snapshot.elapsedMs >= maxDurationMs) {
      return {
        ok: false,
        reason: "max_duration",
        detail: `Ran for ${Math.round(snapshot.elapsedMs / 1000)}s; limit is ${Math.round(maxDurationMs / 1000)}s`,
      };
    }
    return { ok: true };
  }
}
