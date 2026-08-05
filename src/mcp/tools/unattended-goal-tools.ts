import { z } from "zod";
import { db } from "../db";
import {
  activateUnattendedGoal,
  endUnattendedGoal,
  readUnattendedGoalMode,
} from "@/lib/unattended-goal/runtime";
import {
  readUnattendedGoalBudget,
  scheduleUnattendedGoalWakeup,
} from "@/lib/unattended-goal/policy";

interface NotifyTarget {
  active?: boolean;
  gateway?: string;
  scope?: string;
}

async function hasActiveUnattendedGateway(): Promise<boolean> {
  const row = await db.systemConfig.findUnique({ where: { key: "harness.targets" } });
  if (!row) return false;
  try {
    const targets = JSON.parse(row.value) as NotifyTarget[];
    return Array.isArray(targets) && targets.some((target) => {
      const gateway = target.gateway?.trim().toLowerCase();
      return target.active === true
        && (target.scope ?? "unattended") === "unattended"
        && (gateway === "openclaw" || gateway === "hermes");
    });
  } catch {
    return false;
  }
}

export const unattendedGoalTools = {
  set_goal_mode: {
    description:
      "Enable or disable the optional unattended-goal runtime for this task. Enabling is allowed only when " +
      "an active OpenClaw or Hermes unattended channel exists. This records runtime state; it never grants " +
      "third-party write permission or upgrades the risk authorization of the current run. Optionally persist " +
      "one future wakeup; calling on=true again is idempotent and does not reset consumed budget. Child tasks " +
      "report only to the parent Hub; only overall completion, a real blocker, or risky-action approval contacts " +
      "the OWNER. The returned runtime includes durable final-notification failure diagnostics.",
    schema: z.object({
      taskId: z.string().describe("The task entering/leaving unattended goal mode (TOWER_TASK_ID)"),
      on: z.boolean().describe("true = activate, false = end"),
      wakeAfterSeconds: z.number().int().min(10).max(7 * 24 * 60 * 60).optional()
        .describe("Optional durable delay before Tower wakes this Goal for a scheduled re-check"),
      wakeReason: z.string().trim().min(1).max(1_000).optional()
        .describe("Why the scheduled re-check is needed"),
    }),
    handler: async (args: {
      taskId: string;
      on: boolean;
      wakeAfterSeconds?: number;
      wakeReason?: string;
    }) => {
      if (!args.on && args.wakeAfterSeconds !== undefined) {
        throw new Error("A wakeup can only be scheduled while goal mode is enabled");
      }
      if (args.wakeAfterSeconds !== undefined && !args.wakeReason) {
        throw new Error("wakeReason is required when scheduling a Goal wakeup");
      }
      if (args.on && !(await hasActiveUnattendedGateway())) {
        throw new Error(
          "Unattended goal mode requires an active OpenClaw or Hermes unattended channel",
        );
      }
      const runtime = args.on
        ? await activateUnattendedGoal(db, args.taskId)
        : await endUnattendedGoal(db, args.taskId, "DEACTIVATED");
      if (args.on && args.wakeAfterSeconds !== undefined) {
        await scheduleUnattendedGoalWakeup({
          taskId: args.taskId,
          delaySeconds: args.wakeAfterSeconds,
          reason: args.wakeReason!,
        }, db);
      }
      const [current, budget] = await Promise.all([
        readUnattendedGoalMode(db, args.taskId),
        readUnattendedGoalBudget(args.taskId, db),
      ]);
      return {
        ok: true,
        taskId: args.taskId,
        goalMode: current.active,
        runtimeState: current.runtime?.state ?? runtime.state,
        nextWakeAt: current.runtime?.nextWakeAt?.toISOString() ?? null,
        budget: budget?.snapshot ?? null,
        limits: current.runtime?.policy ?? null,
        authorizationGranted: false,
      };
    },
  },
};
