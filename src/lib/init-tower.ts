/**
 * Ensure .tower/ directory exists with assistant persona and skill files.
 * Called once on server startup via instrumentation.ts.
 * Idempotent — skips files that already exist.
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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
  const root = process.cwd();
  const towerDir = join(root, ".tower");
  const claudeMd = join(towerDir, "CLAUDE.md");
  const skillSrc = join(root, "skills", "tower", "SKILL.md");
  const skillDestDir = join(towerDir, ".claude", "skills", "tower");
  const skillDest = join(skillDestDir, "SKILL.md");

  // 1. Ensure .tower/ exists
  if (!existsSync(towerDir)) {
    mkdirSync(towerDir, { recursive: true });
    console.error("[init-tower] Created .tower/");
  }

  // 2. Ensure CLAUDE.md exists
  if (!existsSync(claudeMd)) {
    writeFileSync(claudeMd, CLAUDE_MD_CONTENT, "utf-8");
    console.error("[init-tower] Created .tower/CLAUDE.md");
  }

  // 3. Copy SKILL.md from source if missing
  if (existsSync(skillSrc) && !existsSync(skillDest)) {
    mkdirSync(skillDestDir, { recursive: true });
    copyFileSync(skillSrc, skillDest);
    console.error("[init-tower] Copied SKILL.md → .tower/.claude/skills/tower/");
  }

  // 4. Auto-install Claude Code hooks (SessionStart + PostToolUse)
  ensureClaudeHooks();

  return towerDir;
}

/**
 * Ensure Tower hooks are registered in ~/.claude/settings.json.
 * Idempotent — skips if hooks already present.
 */
function ensureClaudeHooks(): void {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  // Use forward slashes for cross-platform compatibility in hook commands
  const root = process.cwd().replace(/\\/g, "/");

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
  let changed = false;

  // SessionStart hook — reports sessionId
  const sessionStartEntries = (hooks["SessionStart"] as Array<{ hooks: Array<{ command: string }> }>) ?? [];
  const hasSessionStart = sessionStartEntries.some(
    (e) => e.hooks?.some((h) => h.command?.includes("session-start-hook.js"))
  );
  if (!hasSessionStart) {
    const hookPath = join(root, "scripts", "session-start-hook.js").replace(/\\/g, "/");
    sessionStartEntries.push({
      hooks: [{ command: `node "${hookPath}"`, timeout: 5, type: "command" } as never],
    });
    hooks["SessionStart"] = sessionStartEntries;
    changed = true;
    console.error("[init-tower] Installed SessionStart hook");
  }

  // PostToolUse hook — auto-uploads files
  const postToolEntries = (hooks["PostToolUse"] as Array<{ hooks: Array<{ command: string }> }>) ?? [];
  const hasPostTool = postToolEntries.some(
    (e) => e.hooks?.some((h) => h.command?.includes("post-tool-hook.js"))
  );
  if (!hasPostTool) {
    const hookPath = join(root, "scripts", "post-tool-hook.js").replace(/\\/g, "/");
    postToolEntries.push({
      hooks: [{ command: `node "${hookPath}"`, timeout: 10, type: "command" } as never],
      matcher: "Write|Edit|MultiEdit",
    } as never);
    hooks["PostToolUse"] = postToolEntries;
    changed = true;
    console.error("[init-tower] Installed PostToolUse hook");
  }

  // Stop hook — notifies Tower when Claude finishes responding
  const stopEntries = (hooks["Stop"] as Array<{ hooks: Array<{ command: string }> }>) ?? [];
  const hasStop = stopEntries.some(
    (e) => e.hooks?.some((h) => h.command?.includes("stop-hook.js"))
  );
  if (!hasStop) {
    const hookPath = join(root, "scripts", "stop-hook.js").replace(/\\/g, "/");
    stopEntries.push({
      hooks: [{ command: `node "${hookPath}"`, timeout: 5, type: "command" } as never],
    });
    hooks["Stop"] = stopEntries;
    changed = true;
    console.error("[init-tower] Installed Stop hook");
  }

  if (changed) {
    settings["hooks"] = hooks;
    const dir = join(homedir(), ".claude");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  }
}
