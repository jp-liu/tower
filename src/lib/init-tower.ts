/**
 * Ensure .tower/ directory exists with assistant persona and skill files.
 * Called once on server startup via instrumentation.ts.
 * Idempotent — skips files that already exist.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { join } from "path";

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

  return towerDir;
}
