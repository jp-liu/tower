/**
 * Ensure .tower/ directory exists with assistant persona and skill files.
 * Called once on server startup via instrumentation.ts.
 * Idempotent — skips files that already exist.
 *
 * Also auto-installs hooks and MCP server config for all registered providers.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { getAssistantDir, getTowerDbPath } from "./tower-dir";
import { providerRegistry } from "./ai/providers";
import type { McpServerConfig } from "./ai/types";

const CLAUDE_MD_CONTENT = `# Tower Assistant

你是 Tower Assistant — Tower 任务管理平台的内置 AI 操作员。

## 身份

- 你是一个**任务管理操作员**，不是编程助手
- 你通过 Tower MCP 工具帮助用户管理工作区、项目、任务
- 你**不能**读写文件、运行命令、编辑代码、搜索网页
- 如果用户请求你无法完成的操作，告诉他们需要通过开发 MCP 扩展来支持

## 回复风格

- 使用用户的语言回复（中文问中文答，英文问英文答）
- 简洁明了，不要冗长的解释
- 主动使用工具查询信息，而不是猜测
- 当用户问"你能做什么"时，只列出 Tower MCP 工具提供的能力
`;

export function ensureTowerDir(): string {
  const assistantDir = getAssistantDir();
  const claudeMd = join(assistantDir, "CLAUDE.md");
  const root = process.cwd();
  const skillSrc = join(root, "skills", "tower", "SKILL.md");
  const skillDestDir = join(assistantDir, ".claude", "skills", "tower");
  const skillDest = join(skillDestDir, "SKILL.md");

  // 2. Ensure CLAUDE.md exists
  if (!existsSync(claudeMd)) {
    writeFileSync(claudeMd, CLAUDE_MD_CONTENT, "utf-8");
    console.error(`[init-tower] Created ${claudeMd}`);
  }

  // 3. Copy SKILL.md from source if missing
  if (existsSync(skillSrc) && !existsSync(skillDest)) {
    mkdirSync(skillDestDir, { recursive: true });
    copyFileSync(skillSrc, skillDest);
    console.error(`[init-tower] Copied SKILL.md → ${skillDestDir}`);
  }

  // 4. Ensure assistant-local MCP config (tower MCP in project-level settings)
  ensureAssistantMcpConfig(assistantDir);

  // 5. Auto-install hooks and MCP for all available providers (global)
  void ensureProviderIntegrations();

  return assistantDir;
}

/**
 * Write MCP config into the assistant's project-level .claude/settings.json.
 * Claude CLI reads project-level settings from cwd/.claude/settings.json,
 * so the assistant session (cwd = assistantDir) picks up this config.
 * Uses the same "tower" name — project-level overrides global if both exist.
 */
function ensureAssistantMcpConfig(assistantDir: string): void {
  const settingsDir = join(assistantDir, ".claude");
  const settingsFile = join(settingsDir, "settings.json");

  const mcpConfig = buildTowerMcpConfig();
  const entry: Record<string, unknown> = {
    command: mcpConfig.command,
    args: mcpConfig.args,
  };
  if (mcpConfig.env && Object.keys(mcpConfig.env).length > 0) {
    entry.env = mcpConfig.env;
  }

  // Read existing settings or start fresh
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsFile)) {
    try {
      settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
    } catch {
      settings = {};
    }
  }

  const mcpServers = (settings["mcpServers"] as Record<string, unknown>) ?? {};
  const existing = mcpServers["tower"];

  // Only write if config changed (avoid unnecessary disk writes)
  const newJson = JSON.stringify(entry);
  if (JSON.stringify(existing) === newJson) return;

  mcpServers["tower"] = entry;
  settings["mcpServers"] = mcpServers;

  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  console.error(`[init-tower] Updated assistant MCP config → ${settingsFile}`);
}

/**
 * Build the Tower MCP server config for injection into CLI adapters.
 * Passes DATABASE_URL so the MCP subprocess can connect to the same database
 * even when Claude CLI starts it from a different cwd without .env.
 */
function buildTowerMcpConfig(): McpServerConfig {
  const root = process.cwd().replace(/\\/g, "/");

  // Forward DATABASE_URL from the running app — MCP subprocess needs it
  // since it won't have access to the project .env file.
  // Fall back to the default tower DB path when env is not set.
  const dbUrl =
    process.env.DATABASE_URL || `file:${getTowerDbPath().replace(/\\/g, "/")}`;

  // Prefer pre-built JS (fast, no tsx dependency, resolves @/ aliases)
  const builtPath = `${root}/dist/mcp-server.cjs`;

  if (existsSync(builtPath)) {
    return {
      name: "tower",
      command: "node",
      args: [builtPath],
      env: { DATABASE_URL: dbUrl },
    };
  }

  // Fallback: run TS source via project-local tsx (not npx — avoids alias resolution issues)
  return {
    name: "tower",
    command: `${root}/node_modules/.bin/tsx`,
    args: [`${root}/src/mcp/index.ts`],
    env: { DATABASE_URL: dbUrl },
  };
}

/**
 * Install hooks and MCP server config for all registered providers.
 * Uses the CliAdapter interface — each provider handles its own config format.
 * Runs once per process — guarded by _integrationsChecked flag.
 */
let _integrationsChecked = false;

async function ensureProviderIntegrations(): Promise<void> {
  if (_integrationsChecked) return;
  _integrationsChecked = true;

  const mcpConfig = buildTowerMcpConfig();

  for (const provider of providerRegistry.getAll()) {
    const adapter = provider.cli?.adapter;
    if (!adapter) continue;

    const available = await adapter.isAvailable();
    if (!available) continue;

    const label = provider.displayName;

    // Install hooks (only if missing)
    try {
      const hooksInstalled = await adapter.isHooksInstalled();
      if (!hooksInstalled) {
        await adapter.installHooks(`http://localhost:3000`);
        console.error(`[init-tower] Installed hooks for ${label}`);
      }
    } catch (err) {
      console.error(`[init-tower] Failed to install hooks for ${label}:`, err);
    }

    // Install MCP (only if missing)
    try {
      const mcpInstalled = await adapter.isMcpInstalled("tower");
      if (!mcpInstalled) {
        await adapter.installMcp(mcpConfig);
        console.error(`[init-tower] Installed Tower MCP for ${label}`);
      }
    } catch (err) {
      console.error(`[init-tower] Failed to install MCP for ${label}:`, err);
    }
  }
}
