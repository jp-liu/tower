/**
 * Local Tower bootstrap — runs once on server startup via instrumentation.ts.
 *
 * IMPORTANT scope: this file ONLY touches Tower's own data dir (~/.tower) and
 * the embedded assistant's project-level config. It does NOT install MCP /
 * hooks / skills into the user's global ~/.claude or ~/.codex.
 *
 * Why: earlier versions auto-injected those integrations on every boot, which
 * (a) bypassed the CLI's own command surface and (b) ran before we knew the
 * user actually had a working CLI. Provider integration is now triggered by
 * /api/adapters/test on a successful connection probe — see
 * src/lib/ai/install-orchestrator.ts and .notes/ai-provider-integration.md.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { getAssistantDir, getTowerDbPath } from "./tower-dir";
import type { McpServerConfig } from "./ai/types";
import { getTowerMcpName } from "./ai/install-orchestrator";

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

  // Assistant CLAUDE.md
  if (!existsSync(claudeMd)) {
    writeFileSync(claudeMd, CLAUDE_MD_CONTENT, "utf-8");
    console.error(`[init-tower] Created ${claudeMd}`);
  }

  // Assistant skill — file copy is intentional here (not symlink). The
  // assistant's config dir is Tower-owned and short-lived per session, so
  // a stable copy avoids surprises if the user moves the repo.
  if (existsSync(skillSrc) && !existsSync(skillDest)) {
    mkdirSync(skillDestDir, { recursive: true });
    copyFileSync(skillSrc, skillDest);
    console.error(`[init-tower] Copied SKILL.md → ${skillDestDir}`);
  }

  // Legacy cleanup: prior Tower versions wrote MCP config to project-scope
  // files under the assistant dir. Both are obsolete now — boot-time
  // installation goes straight to each provider's user-scope via its CLI
  // (see instrumentation.ts → ensureProviderMcpInstalled).
  cleanupLegacyAssistantMcp(assistantDir);

  return assistantDir;
}

/**
 * Remove stale MCP entries from prior Tower installations:
 *
 *   1. `<assistantDir>/.claude/settings.json` — written by Tower ≤ Claude CLI
 *      3.x era; ignored by Claude 4.x.
 *   2. `<assistantDir>/.mcp.json` — short-lived intermediate path written by
 *      Tower in 2026-05; now superseded by user-scope auto-install at boot.
 *
 * Both removals are non-destructive: only `mcpServers` keys we recognize are
 * stripped, the surrounding file is preserved.
 */
function cleanupLegacyAssistantMcp(assistantDir: string): void {
  // (1) .claude/settings.json — drop mcpServers field, keep file
  const settingsFile = join(assistantDir, ".claude", "settings.json");
  if (existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(readFileSync(settingsFile, "utf-8")) as Record<string, unknown>;
      if (settings && "mcpServers" in settings) {
        delete settings["mcpServers"];
        writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf-8");
        console.error(`[init-tower] Removed legacy mcpServers from ${settingsFile}`);
      }
    } catch {
      // best-effort
    }
  }

  // (2) .mcp.json — if it only contained the tower entry we wrote, delete the
  // whole file; if it has other entries, drop just `mcpServers.<towerName>`
  const mcpFile = join(assistantDir, ".mcp.json");
  if (existsSync(mcpFile)) {
    try {
      const towerName = buildTowerMcpConfig().name;
      const mcpJson = JSON.parse(readFileSync(mcpFile, "utf-8")) as Record<string, unknown>;
      const mcpServers = (mcpJson["mcpServers"] as Record<string, unknown>) ?? {};
      if (towerName in mcpServers) {
        delete mcpServers[towerName];
        if (Object.keys(mcpServers).length === 0) {
          delete mcpJson["mcpServers"];
        } else {
          mcpJson["mcpServers"] = mcpServers;
        }
        writeFileSync(mcpFile, JSON.stringify(mcpJson, null, 2) + "\n", "utf-8");
        console.error(`[init-tower] Removed legacy tower entry from ${mcpFile}`);
      }
    } catch {
      // best-effort
    }
  }
}

/**
 * Build the Tower MCP server config for the embedded assistant. Kept here
 * (instead of imported from install-orchestrator) so this file has zero
 * coupling to the provider integration code path that runs after test-connect.
 */
function buildTowerMcpConfig(): McpServerConfig {
  const root = process.cwd().replace(/\\/g, "/");
  const dbUrl =
    process.env.DATABASE_URL || `file:${getTowerDbPath().replace(/\\/g, "/")}`;
  const builtPath = `${root}/dist/mcp-server.cjs`;
  // Match the user-scope name so the assistant's project-scope MCP and the
  // user-scope CLI install refer to the same logical server. (Project scope
  // overrides user scope in Claude — both pointing at the same env-bound DB
  // means there's no surprise when the assistant runs.)
  const name = getTowerMcpName();

  if (existsSync(builtPath)) {
    return {
      name,
      command: "node",
      args: [builtPath],
      env: { DATABASE_URL: dbUrl },
    };
  }

  return {
    name,
    command: `${root}/node_modules/.bin/tsx`,
    args: [`${root}/src/mcp/index.ts`],
    env: { DATABASE_URL: dbUrl },
  };
}
