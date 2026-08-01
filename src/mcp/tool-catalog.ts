import { workspaceTools } from "./tools/workspace-tools";
import { projectTools } from "./tools/project-tools";
import { taskTools } from "./tools/task-tools";
import { labelTools } from "./tools/label-tools";
import { searchTools } from "./tools/search-tools";
import { knowledgeTools } from "./tools/knowledge-tools";
import { noteAssetTools } from "./tools/note-asset-tools";
import { terminalTools } from "./tools/terminal-tools";
import { reportTools } from "./tools/report-tools";
import { harnessTools } from "./tools/harness-tools";
import { knowledgeBaseTools } from "./tools/knowledge-base-tools";
import { unattendedGoalTools } from "./tools/unattended-goal-tools";
import { gatewayCapabilityTools } from "./tools/gateway-capability-tools";
import {
  parseMcpToolProfile,
  toolProfileNames,
  type McpToolProfile,
} from "./tool-capabilities";

/** Tower-owned orchestration tools available to the in-process Assistant. */
export const assistantTowerToolCatalog = {
  ...workspaceTools,
  ...projectTools,
  ...taskTools,
  ...labelTools,
  ...searchTools,
  ...knowledgeTools,
  ...noteAssetTools,
  ...terminalTools,
  ...reportTools,
  ...knowledgeBaseTools,
};

/** Complete MCP catalog. Harness messaging stays MCP-only and is not exposed to API models. */
export const towerToolCatalog = {
  ...assistantTowerToolCatalog,
  ...unattendedGoalTools,
  ...gatewayCapabilityTools,
  ...harnessTools,
};

type TowerToolCatalog = typeof towerToolCatalog;

export function getTowerToolCatalog(profile: McpToolProfile | string | undefined = "full") {
  const parsedProfile = parseMcpToolProfile(profile);
  if (parsedProfile === "full") return towerToolCatalog;
  if (parsedProfile === "assistant") return assistantTowerToolCatalog;
  return Object.fromEntries(
    toolProfileNames[parsedProfile].map((name) => [name, towerToolCatalog[name]]),
  ) as Partial<TowerToolCatalog>;
}

export type { McpToolProfile, TowerToolName } from "./tool-capabilities";
