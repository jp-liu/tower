import "server-only";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { addPtyLifecycleObserver } from "@/lib/pty/lifecycle";
import { recordUnattendedGoalProgressFact } from "./policy";

const log = logger.create("unattended-goal-pty-lifecycle");

export function registerUnattendedGoalPtyLifecycle(): void {
  addPtyLifecycleObserver({
    async providerTurnCompleted(taskId, turnKey) {
      if (!turnKey) return;
      await recordUnattendedGoalProgressFact({
        taskId,
        kind: "PROVIDER_TURN_COMPLETED",
        dedupKey: `provider-turn:${taskId}:${turnKey}`,
      }, db).catch((error) => {
        log.warn("Failed to record unattended Goal provider turn", {
          taskId,
          turnKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  });
}
