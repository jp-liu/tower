import type { ProviderDefinition } from "../types";
import { towerCliPlugin } from "@tower/ai-provider-claude";
import { createBuiltInAdapter } from "../provider-host";

export function createClaudeProvider(): ProviderDefinition {
  const builtIn = { id: "claude", agentFieldValue: "CLAUDE_CODE", plugin: towerCliPlugin };
  return {
    name: "claude",
    displayName: "Claude Code",
    agentFieldValue: "CLAUDE_CODE",
    builtin: true,
    cli: {
      command: "claude",
      plugin: towerCliPlugin,
      adapter: createBuiltInAdapter(builtIn),
    },
    // api and cliQuery adapters will be added in Phase 2
    models: {
      cli: ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
      api: [],
    },
  };
}
