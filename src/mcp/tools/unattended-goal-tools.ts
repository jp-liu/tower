import { z } from "zod";
import { db } from "../db";
import {
  activateUnattendedGoal,
  endUnattendedGoal,
} from "@/lib/unattended-goal/runtime";

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
      "third-party write permission or upgrades the risk authorization of the current run.",
    schema: z.object({
      taskId: z.string().describe("The task entering/leaving unattended goal mode (TOWER_TASK_ID)"),
      on: z.boolean().describe("true = activate, false = end"),
    }),
    handler: async (args: { taskId: string; on: boolean }) => {
      if (args.on && !(await hasActiveUnattendedGateway())) {
        throw new Error(
          "Unattended goal mode requires an active OpenClaw or Hermes unattended channel",
        );
      }
      const runtime = args.on
        ? await activateUnattendedGoal(db, args.taskId)
        : await endUnattendedGoal(db, args.taskId, "DEACTIVATED");
      return {
        ok: true,
        taskId: args.taskId,
        goalMode: runtime.active,
        runtimeState: runtime.state,
        authorizationGranted: false,
      };
    },
  },
};
