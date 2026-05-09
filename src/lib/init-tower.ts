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

  // MCP config for the embedded assistant. The assistant runs with
  // cwd=assistantDir and reads `<assistantDir>/.claude/settings.json`. We
  // write this directly (not via `claude mcp add -s project`) because the
  // assistant must work even if the user's `claude` binary is misconfigured —
  // and this dir is ours alone, so direct write is safe.
  ensureAssistantMcpConfig(assistantDir);

  return assistantDir;
}

/**
 * Write MCP config into the assistant's project-level .claude/settings.json.
 * Direct file write is intentional — see comment in ensureTowerDir().
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

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsFile)) {
    try {
      settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
    } catch {
      settings = {};
    }
  }

  const mcpServers = (settings["mcpServers"] as Record<string, unknown>) ?? {};
  // Use the same dynamic name as the user-scope install so dev/prod don't
  // share the assistant's project-scope `tower` key either.
  const name = mcpConfig.name;
  const existing = mcpServers[name];

  const newJson = JSON.stringify(entry);
  if (JSON.stringify(existing) === newJson) return;

  mcpServers[name] = entry;
  settings["mcpServers"] = mcpServers;

  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  console.error(`[init-tower] Updated assistant MCP config → ${settingsFile}`);
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
