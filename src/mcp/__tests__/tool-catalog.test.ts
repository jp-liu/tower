import { describe, expect, it } from "vitest";
import { taskTools } from "../tools/task-tools";
import { harnessTools } from "../tools/harness-tools";
import { assistantTowerToolCatalog, towerToolCatalog } from "../tool-catalog";

describe("Tower tool catalog", () => {
  it("shares MCP schemas and handlers while excluding Harness messaging from Assistant", () => {
    expect(towerToolCatalog.create_task).toBe(taskTools.create_task);
    expect(assistantTowerToolCatalog.create_task).toBe(taskTools.create_task);
    expect(towerToolCatalog.list_notify_targets).toBe(harnessTools.list_notify_targets);
    expect("list_notify_targets" in assistantTowerToolCatalog).toBe(false);
    expect(Object.keys(towerToolCatalog).length).toBe(
      Object.keys(assistantTowerToolCatalog).length + Object.keys(harnessTools).length,
    );
  });
});
