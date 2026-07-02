/**
 * 成本防跑飞的抽象闸门（定稿 ③ 预留口子）。
 *
 * CLI 模式扣不准真实 token，Phase 1 先用「回合数 / 时长」做代理度量；后续加 api-token 计量
 * 实现时只换 {@link BudgetGuard} 的实现、不改调用点。
 *
 * 铁律：超限动作永远是「升级问人」—— 调用方拿到 `ok:false` 应转 `ask_human` 把决定权交给人，
 * 绝不静默杀进程 / 放弃 / 无限重试。看门狗（输出静默检测）与真正的调用接线属 Phase 3。
 */
export interface BudgetSnapshot {
  /** 已消耗的回合数（一次 stop hook = 一回合）。 */
  turns: number;
  /** 自启动以来的已运行时长（毫秒）。 */
  elapsedMs: number;
}

export interface BudgetLimits {
  maxTurns?: number;
  maxDurationMs?: number;
}

export type BudgetVerdict =
  | { ok: true }
  | { ok: false; reason: "max_turns" | "max_duration"; detail: string };

export interface BudgetGuard {
  /** 未超返回 `{ ok: true }`；超限返回带 reason/detail 的 `{ ok: false }`（调用方据此升级问人）。 */
  check(snapshot: BudgetSnapshot): BudgetVerdict;
}

/** Phase 1 代理实现：以回合数 / 时长封顶。未设的项不参与判定。 */
export class TurnTimeBudgetGuard implements BudgetGuard {
  constructor(private readonly limits: BudgetLimits) {}

  check(snapshot: BudgetSnapshot): BudgetVerdict {
    const { maxTurns, maxDurationMs } = this.limits;
    if (maxTurns !== undefined && snapshot.turns >= maxTurns) {
      return {
        ok: false,
        reason: "max_turns",
        detail: `已用 ${snapshot.turns} 回合，达上限 ${maxTurns}`,
      };
    }
    if (maxDurationMs !== undefined && snapshot.elapsedMs >= maxDurationMs) {
      return {
        ok: false,
        reason: "max_duration",
        detail: `已运行 ${Math.round(snapshot.elapsedMs / 1000)}s，达上限 ${Math.round(
          maxDurationMs / 1000
        )}s`,
      };
    }
    return { ok: true };
  }
}
