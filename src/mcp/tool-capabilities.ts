export const toolCapabilityGroups = {
  coreRead: [
    "list_workspaces",
    "list_projects",
    "list_product_groups",
    "list_tasks",
    "list_versions",
    "list_labels",
    "search",
    "identify_project",
    "daily_summary",
    "daily_todo",
    "ask_project_knowledge",
  ],
  coreWrite: [
    "create_workspace",
    "update_workspace",
    "delete_workspace",
    "create_project",
    "update_project",
    "create_product_group",
    "delete_project",
    "create_task",
    "update_task",
    "move_task",
    "delete_task",
    "set_task_defaults",
    "create_label",
    "delete_label",
    "set_task_labels",
    "manage_notes",
    "manage_assets",
    "manage_project_facts",
  ],
  terminalRead: [
    "get_task_terminal_output",
    "get_task_execution_status",
  ],
  terminalWrite: [
    "start_task_execution",
    "send_task_terminal_input",
    "stop_task_execution",
    "resume_task_execution",
  ],
  unattendedGoal: [
    "set_goal_mode",
  ],
  gatewayCapability: [
    "discover_gateway_capabilities",
    "submit_capability_request",
    "get_capability_request_status",
    "get_capability_job_status",
  ],
  messaging: [
    "list_notify_targets",
    "push_to_human",
    "ask_human",
    "notify_human",
  ],
  workbench: [
    "ack_workbench_batch",
    "heartbeat_workbench_batch",
    "resolve_workbench_batch",
    "confirm_gateway_task_created",
    "complete_gateway_work",
  ],
  gatewayQuery: [
    "route_gateway_query",
    "read_gateway_project_context",
    "complete_gateway_discussion",
  ],
  gatewayOwner: [
    "manage_gateway_channel_access",
    "relay_channel_reply",
    "route_gateway_message",
    "resolve_gateway_task_context",
    "continue_bound_task",
    "diagnose_gateway_request",
    "provision_remote_project",
    "reply_to_ask",
  ],
  operations: [
    "recover_gateway_request",
    "get_gateway_runtime_health",
  ],
} as const;

export type ToolCapabilityGroup = keyof typeof toolCapabilityGroups;
export type TowerToolName = (typeof toolCapabilityGroups)[ToolCapabilityGroup][number];

function combineGroups(groups: readonly ToolCapabilityGroup[]): TowerToolName[] {
  return groups.flatMap((group) => [...toolCapabilityGroups[group]]);
}

/** Responsibility-level groups used by documentation and policy consumers. */
export const toolNameGroups = {
  core: combineGroups(["coreRead", "coreWrite"]),
  terminal: combineGroups(["terminalRead", "terminalWrite"]),
  unattendedGoal: [...toolCapabilityGroups.unattendedGoal],
  gatewayCapability: [...toolCapabilityGroups.gatewayCapability],
  messaging: [...toolCapabilityGroups.messaging],
  workbench: [...toolCapabilityGroups.workbench],
  gatewayQuery: [...toolCapabilityGroups.gatewayQuery],
  gatewayOwner: [...toolCapabilityGroups.gatewayOwner],
  operations: [...toolCapabilityGroups.operations],
} as const;

const profileGroups = {
  full: [
    "coreRead",
    "coreWrite",
    "terminalRead",
    "terminalWrite",
    "unattendedGoal",
    "gatewayCapability",
    "messaging",
    "workbench",
    "gatewayQuery",
    "gatewayOwner",
    "operations",
  ],
  assistant: ["coreRead", "coreWrite", "terminalRead", "terminalWrite"],
  task: [
    "coreRead",
    "coreWrite",
    "terminalRead",
    "terminalWrite",
    "unattendedGoal",
    "gatewayCapability",
    "messaging",
    "workbench",
  ],
  gateway: ["coreRead", "terminalRead", "gatewayQuery", "gatewayOwner", "operations"],
  "gateway-query": ["gatewayQuery"],
} as const satisfies Record<string, readonly ToolCapabilityGroup[]>;

export type McpToolProfile = keyof typeof profileGroups;
export const MCP_TOOL_PROFILES = Object.keys(profileGroups) as McpToolProfile[];

export const toolProfileNames = Object.fromEntries(
  Object.entries(profileGroups).map(([profile, groups]) => [
    profile,
    combineGroups(groups),
  ]),
) as Record<McpToolProfile, TowerToolName[]>;

export function parseMcpToolProfile(value: string | undefined): McpToolProfile {
  const profile = value?.trim() || "full";
  if (profile in profileGroups) return profile as McpToolProfile;
  throw new Error(
    `Unknown TOWER_MCP_PROFILE ${JSON.stringify(profile)}. Expected one of: ${MCP_TOOL_PROFILES.join(", ")}`,
  );
}

// New gateway agents use explicit resolve/reply/continue tools. Keep the legacy
// relay in the gateway MCP profile for compatibility, but not in sender policy.
const OPENCLAW_COMPATIBILITY_ONLY_TOOLS = new Set<TowerToolName>(["relay_channel_reply"]);

export const gatewayQueryToolNames = [...toolCapabilityGroups.gatewayQuery];
export const gatewayOwnerToolNames = toolProfileNames.gateway.filter(
  (name) => !OPENCLAW_COMPATIBILITY_ONLY_TOOLS.has(name),
);
