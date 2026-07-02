import { describe, it, expect } from "vitest";
import { TurnTimeBudgetGuard } from "../budget";

describe("TurnTimeBudgetGuard", () => {
  it("两项都未超 → ok", () => {
    const g = new TurnTimeBudgetGuard({ maxTurns: 10, maxDurationMs: 60_000 });
    expect(g.check({ turns: 3, elapsedMs: 10_000 })).toEqual({ ok: true });
  });

  it("回合数达上限 → 不 ok，reason max_turns", () => {
    const g = new TurnTimeBudgetGuard({ maxTurns: 5 });
    const v = g.check({ turns: 5, elapsedMs: 0 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("max_turns");
  });

  it("时长达上限 → 不 ok，reason max_duration", () => {
    const g = new TurnTimeBudgetGuard({ maxDurationMs: 30_000 });
    const v = g.check({ turns: 1, elapsedMs: 30_000 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("max_duration");
  });

  it("未设任何上限 → 恒 ok（代理度量缺省不拦）", () => {
    const g = new TurnTimeBudgetGuard({});
    expect(g.check({ turns: 999, elapsedMs: 9_999_999 }).ok).toBe(true);
  });

  it("两项都超时以 max_turns 优先（先判回合数）", () => {
    const g = new TurnTimeBudgetGuard({ maxTurns: 2, maxDurationMs: 1 });
    const v = g.check({ turns: 10, elapsedMs: 10_000 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("max_turns");
  });
});
