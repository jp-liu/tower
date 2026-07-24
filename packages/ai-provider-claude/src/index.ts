import { defineCliPlugin, type CliPluginManifestV1 } from "@tower/ai-sdk";
import { ClaudeCliAdapter } from "./adapter.js";

export const claudeManifest = {
  manifestVersion: 1,
  apiVersion: "1.0",
  kind: "cli-provider",
  display: {
    name: "Claude Code",
    description: "Official Tower provider for the Claude Code CLI",
  },
  command: {
    default: "claude",
    aliases: ["claude-code"],
    knownPaths: {
      darwin: ["~/.local/bin/claude", "~/.claude/local/claude"],
      linux: ["~/.local/bin/claude", "~/.claude/local/claude"],
      win32: ["%USERPROFILE%\\.local\\bin\\claude.exe", "%APPDATA%\\npm\\claude.cmd"],
    },
    versionArgs: ["--version"],
  },
  compatibility: { tower: ">=0.2.60 <0.4.0", node: ">=18" },
  capabilities: {
    sessions: { fresh: true, resume: true, continue: true },
    query: { generate: true },
    models: true,
    integrations: { mcp: true, hooks: true, skills: true },
  },
  permissions: [
    "process:spawn",
    "filesystem:provider-config",
    "network:provider",
    "integration:mcp",
    "integration:hooks",
    "integration:skills",
  ],
  configSchema: "./config.schema.json",
} satisfies CliPluginManifestV1;

export const towerCliPlugin = defineCliPlugin({
  manifest: claudeManifest,
  createAdapter: (host) => new ClaudeCliAdapter(host),
});

export { ClaudeCliAdapter } from "./adapter.js";
