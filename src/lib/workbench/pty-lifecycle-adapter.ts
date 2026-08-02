import "server-only";

import { logger } from "@/lib/logger";
import { addPtyLifecycleObserver } from "@/lib/pty/lifecycle";
import { closeWorkbenchDrainBoundary } from "./boundary";
import {
  openWorkbenchDrainBoundary,
  recordWorkbenchProviderTurnCompleted,
} from "./coordinator";

const log = logger.create("workbench-pty-lifecycle");

export function registerWorkbenchPtyLifecycle(): void {
  addPtyLifecycleObserver({
    inputStarted(taskId) {
      closeWorkbenchDrainBoundary(taskId);
    },
    async providerTurnCompleted(taskId) {
      openWorkbenchDrainBoundary(taskId);
      await recordWorkbenchProviderTurnCompleted(taskId).catch((error) => {
        log.warn("Failed to project provider turn completion", {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  });
}
