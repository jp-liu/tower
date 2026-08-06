import { defineCliPlugin, type CliPluginManifestV1 } from "@tower-org/ai-sdk";
import { ClaudeCliAdapter } from "./adapter.js";

export const providerVersion = "0.1.0";

export const claudeManifest = {
  manifestVersion: 1,
  apiVersion: "1.0",
  id: "tower.claude-code",
  kind: "cli-provider",
  publisher: { id: "tower", name: "Tower" },
  display: {
    name: "Claude Code",
    description: "Official Tower provider for the Claude Code CLI",
  },
  entry: "./dist/index.js",
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
  cliDependency: {
    name: "Claude Code CLI",
    homepage: "https://docs.anthropic.com/en/docs/claude-code/overview",
    installDocs: "https://docs.anthropic.com/en/docs/claude-code/setup",
    supportedVersions: ">=1.0.0",
    managedByTower: false,
  },
  compatibility: { tower: ">=0.3.0 <1.0.0", node: ">=18" },
  capabilities: {
    sessions: { fresh: true, resume: true, continue: true },
    query: { generate: true, stream: true },
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
