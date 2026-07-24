/**
 * Local Tower bootstrap — runs once on server startup via instrumentation.ts.
 *
 * IMPORTANT scope: this file ONLY touches Tower's own data dir (~/.tower) and
 * the embedded assistant's project-level config. User-scope provider MCP /
 * hooks / skills are managed separately by instrumentation.ts: after a Tower
 * update or an explicitly stale database state, it reinstalls and verifies the
 * provider integration once. Current installs are skipped on ordinary starts.
 */

import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { getAssistantDir } from "./tower-dir";
import { getTowerMcpName } from "./ai/install-orchestrator";
import { getPackageRoot } from "./tower-paths";

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

## 行动准则（最重要）

- **说到就做，绝不只announce不action**：一旦信息足够，就在**同一轮回复里直接调用对应的 MCP 工具**完成操作。
- **严禁**只回复「我现在立即创建」「好的，立即创建」「马上为你处理」这类话却不实际发出工具调用。这种回复等于没做事，会让用户反复追问。
- 信息不足时（例如缺项目、缺必填项），**直接提出具体问题**问用户，而不是含糊地说「我来创建」。
- 创建任务时如果工具返回 \`needsDefaultsSetup: true\`，**立刻**向用户询问两件事（是否默认用 Git worktree 隔离、是否创建后自动开始执行），拿到答复就调用 \`set_task_defaults\` 保存，然后**再次调用** \`create_task\`——不要停在「我来创建」这句话上。
- 用户催你（如「创建了吗？」「快创建」）时，说明上一轮你没真正调用工具——这一轮必须立即发出工具调用，而不是再次口头答应。

## 创建 / 编辑任务的 description（硬约束，无例外）

- 调用 \`create_task\` / \`update_task\` 时，\`description\` **必须**是结构化 Markdown，按顺序包含这些二级标题：\`## 目标\` / \`## 需求\` / \`## 参考\` / \`## 备注\` / \`## 来源\`。
- **没有「任务简单就跳过」这一说**——哪怕用户只说一句话，也要拆成 \`## 目标\`（一句话目标）+ \`## 需求\`（可执行的要点列表），并以 \`## 来源\` 收尾（无来源就写 \`## 来源\` 再换行 \`无\`）。
- **绝不**把用户原话整段照抄进 \`description\`。\`## 参考\` / \`## 备注\` 没内容可省略，但 \`## 目标\`、\`## 需求\`、\`## 来源\` 必带。
- 来源（\`## 来源\`）的详细写法、飞书 \`<task-source>\` 解析、父任务派生等，见 tower skill 的「Task Description Format」与 \`references/task-source.md\`。
`;

/** Read a file as UTF-8, returning null if it doesn't exist or can't be read. */
function safeRead(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

export function ensureTowerDir(): string {
  const assistantDir = getAssistantDir();
  const claudeMd = join(assistantDir, "CLAUDE.md");
  const root = getPackageRoot();
  const skillSrc = join(root, "skills", "tower", "SKILL.md");
  const skillDestDir = join(assistantDir, ".claude", "skills", "tower");
  const skillDest = join(skillDestDir, "SKILL.md");

  // Assistant CLAUDE.md — refresh when missing or stale. These files are
  // Tower-owned (not a user customization point), so we overwrite on content
  // change. Write-once would strand upgraders on an old persona — e.g. the
  // "act, don't just announce" rules below would never reach existing installs.
  if (!existsSync(claudeMd) || safeRead(claudeMd) !== CLAUDE_MD_CONTENT) {
    writeFileSync(claudeMd, CLAUDE_MD_CONTENT, "utf-8");
    console.error(`[init-tower] Wrote ${claudeMd}`);
  }

  // Assistant skill — directory copy (not symlink). The assistant's config dir
  // is Tower-owned, so we refresh the whole skill dir (SKILL.md + references/*)
  // whenever the bundled SKILL.md changes or the copy is missing; otherwise
  // upgraders keep running the old skill. We must copy references/ too: SKILL.md
  // links to references/*.md that the assistant Reads on demand — splitting the
  // heavy, situational sections out keeps the per-turn `/tower` reload lean.
  const skillSrcDir = join(root, "skills", "tower");
  if (existsSync(skillSrc)) {
    const bundled = safeRead(skillSrc);
    const refsDest = join(skillDestDir, "references");
    const stale = !existsSync(skillDest) || safeRead(skillDest) !== bundled;
    if (bundled !== null && (stale || !existsSync(refsDest))) {
      mkdirSync(skillDestDir, { recursive: true });
      cpSync(skillSrcDir, skillDestDir, { recursive: true });
      console.error(`[init-tower] Copied tower skill (+references) → ${skillDestDir}`);
    }
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
      const towerName = getTowerMcpName();
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
