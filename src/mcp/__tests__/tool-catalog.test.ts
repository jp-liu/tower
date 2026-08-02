import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { taskTools } from "../tools/task-tools";
import { harnessTools } from "../tools/harness-tools";
import { unattendedGoalTools } from "../tools/unattended-goal-tools";
import { gatewayCapabilityTools } from "../tools/gateway-capability-tools";
import {
  gatewayOwnerToolNames,
  gatewayQueryToolNames,
  parseMcpToolProfile,
  toolCapabilityGroups,
  toolNameGroups,
  toolProfileNames,
} from "../tool-capabilities";
import {
  assistantTowerToolCatalog,
  getTowerToolCatalog,
  towerToolCatalog,
} from "../tool-catalog";

const LEGACY_FULL_TOOL_NAMES = [
  "list_workspaces", "create_workspace", "update_workspace", "delete_workspace",
  "list_projects", "create_project", "update_project", "list_product_groups",
  "create_product_group", "delete_project", "list_tasks", "create_task",
  "update_task", "move_task", "delete_task", "set_goal_mode", "set_task_defaults",
  "list_versions", "list_labels", "create_label", "delete_label", "set_task_labels",
  "search", "identify_project", "manage_notes", "manage_assets", "start_task_execution",
  "get_task_terminal_output", "send_task_terminal_input", "stop_task_execution",
  "resume_task_execution", "get_task_execution_status", "daily_summary", "daily_todo",
  "ask_project_knowledge", "manage_project_facts", "list_notify_targets", "push_to_human",
  "relay_channel_reply", "route_gateway_message", "resolve_gateway_task_context",
  "continue_bound_task", "route_gateway_query", "read_gateway_project_context",
  "diagnose_gateway_request", "recover_gateway_request", "get_gateway_runtime_health",
  "provision_remote_project", "complete_gateway_discussion", "ack_workbench_batch",
  "heartbeat_workbench_batch", "resolve_workbench_batch", "confirm_gateway_task_created",
  "complete_gateway_work", "ask_human", "notify_human", "reply_to_ask",
  "discover_gateway_capabilities", "submit_capability_request",
  "get_capability_request_status", "get_capability_job_status",
];
const ASSISTANT_TOOL_NAMES = LEGACY_FULL_TOOL_NAMES
  .slice(0, 36)
  .filter((name) => name !== "set_goal_mode");

describe("Tower tool catalog", () => {
  it("preserves the legacy full and Assistant surfaces", () => {
    expect(Object.keys(towerToolCatalog).sort()).toEqual([...LEGACY_FULL_TOOL_NAMES].sort());
    expect(Object.keys(towerToolCatalog)).toHaveLength(61);
    expect(Object.keys(assistantTowerToolCatalog)).toEqual(ASSISTANT_TOOL_NAMES);
    expect(towerToolCatalog.create_task).toBe(taskTools.create_task);
    expect(assistantTowerToolCatalog.create_task).toBe(taskTools.create_task);
    expect(towerToolCatalog.list_notify_targets).toBe(harnessTools.list_notify_targets);
    expect(towerToolCatalog.set_goal_mode).toBe(unattendedGoalTools.set_goal_mode);
    expect(towerToolCatalog.get_capability_job_status).toBe(
      gatewayCapabilityTools.get_capability_job_status,
    );
    expect(towerToolCatalog.submit_capability_request).toBe(
      gatewayCapabilityTools.submit_capability_request,
    );
    expect(assistantTowerToolCatalog).not.toHaveProperty("set_goal_mode");
  });

  it("assigns every runtime tool to exactly one atomic capability group", () => {
    const declared = Object.values(toolCapabilityGroups).flat();
    expect(new Set(declared).size).toBe(declared.length);
    expect([...declared].sort()).toEqual([...LEGACY_FULL_TOOL_NAMES].sort());
  });

  it("builds responsibility groups and profiles from the atomic catalog", () => {
    expect(toolNameGroups.core).toHaveLength(29);
    expect(toolNameGroups.terminal).toHaveLength(6);
    expect(toolNameGroups.unattendedGoal).toEqual(["set_goal_mode"]);
    expect(toolNameGroups.gatewayCapability).toEqual([
      "discover_gateway_capabilities",
      "submit_capability_request",
      "get_capability_request_status",
      "get_capability_job_status",
    ]);
    expect(toolProfileNames.full).toHaveLength(61);
    expect(toolProfileNames.assistant).toHaveLength(35);
    expect(toolProfileNames.task).toHaveLength(49);
    expect(toolProfileNames.gateway).toHaveLength(25);
    expect(toolProfileNames["gateway-query"]).toEqual(gatewayQueryToolNames);

    for (const [profile, names] of Object.entries(toolProfileNames)) {
      expect(Object.keys(getTowerToolCatalog(profile)).sort()).toEqual([...names].sort());
    }
  });

  it("keeps mutating owner capabilities out of the read-only gateway profile", () => {
    expect(toolProfileNames["gateway-query"]).not.toEqual(
      expect.arrayContaining(gatewayOwnerToolNames),
    );
    expect(toolProfileNames["gateway-query"]).not.toContain("create_task");
    expect(toolProfileNames["gateway-query"]).not.toContain("continue_bound_task");
  });

  it("defaults to full and rejects unknown profiles", () => {
    expect(parseMcpToolProfile(undefined)).toBe("full");
    expect(Object.keys(getTowerToolCatalog()).sort()).toEqual([...LEGACY_FULL_TOOL_NAMES].sort());
    expect(() => parseMcpToolProfile("everything")).toThrow(
      /Unknown TOWER_MCP_PROFILE.*full, assistant, task, gateway, gateway-query/,
    );
  });

  it("keeps agent and module docs tied to catalog metadata instead of manual totals", () => {
    const root = process.cwd();
    const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8");
    const toolSection = agents.slice(
      agents.indexOf("## Available MCP Tools"),
      agents.indexOf("## Server Actions"),
    );
    for (const name of LEGACY_FULL_TOOL_NAMES) {
      expect(toolSection, `AGENTS.md is missing ${name}`).toContain(`\`${name}\``);
    }

    for (const relativePath of ["AGENTS.md", "docs/modules/mcp.md", "docs/en/modules/mcp.md"]) {
      const contents = fs.readFileSync(path.join(root, relativePath), "utf-8");
      expect(contents).not.toMatch(/\b\d+ tools across\b|共\s*\d+\s*个工具|\b\d+ tools cover\b/);
      expect(contents).toContain("tool-capabilities.ts");
    }
  });
});
