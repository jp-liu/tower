import type { ProviderDefinition } from "../types";
import { ClaudeCliAdapter } from "../adapters/cli/claude-cli-adapter";

export function createClaudeProvider(): ProviderDefinition {
  return {
    name: "claude",
    displayName: "Claude Code",
    agentFieldValue: "CLAUDE_CODE",
    cli: {
      command: "claude",
      adapter: new ClaudeCliAdapter(),
    },
    // api and cliQuery adapters will be added in Phase 2
    models: {
      cli: ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
      api: [],
    },
  };
}
