/**
 * Initialize .tower/ directory for the Tower Assistant.
 *
 * Run automatically via `pnpm dev` or manually via `pnpm tower:init`.
 * Idempotent — skips files that already exist.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const TOWER_DIR = join(ROOT, ".tower");
const SKILL_SRC = join(ROOT, "skills", "tower", "SKILL.md");
const SKILL_DEST_DIR = join(TOWER_DIR, ".claude", "skills", "tower");
const SKILL_DEST = join(SKILL_DEST_DIR, "SKILL.md");

let changed = false;

// 1. Ensure .tower/ exists
if (!existsSync(TOWER_DIR)) {
  mkdirSync(TOWER_DIR, { recursive: true });
  console.log("[init-tower] Created .tower/");
  changed = true;
}

// 2. Ensure .tower/CLAUDE.md exists
const claudeMd = join(TOWER_DIR, "CLAUDE.md");
if (!existsSync(claudeMd)) {
  writeFileSync(
    claudeMd,
    `# Tower Assistant

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
`,
    "utf-8"
  );
  console.log("[init-tower] Created .tower/CLAUDE.md");
  changed = true;
}

// 3. Ensure .tower/.claude/skills/tower/SKILL.md exists (copy from source)
if (existsSync(SKILL_SRC)) {
  if (!existsSync(SKILL_DEST)) {
    mkdirSync(SKILL_DEST_DIR, { recursive: true });
    copyFileSync(SKILL_SRC, SKILL_DEST);
    console.log("[init-tower] Copied SKILL.md → .tower/.claude/skills/tower/");
    changed = true;
  }
} else {
  console.log("[init-tower] Warning: skills/tower/SKILL.md not found, skipping skill copy");
}

if (!changed) {
  console.log("[init-tower] .tower/ already initialized, nothing to do");
}
