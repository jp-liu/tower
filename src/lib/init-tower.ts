/**
 * Ensure .tower/ directory exists with assistant persona and skill files.
 * Called once on server startup via instrumentation.ts.
 * Idempotent — skips files that already exist.
 *
 * Also auto-installs hooks and MCP server config for all registered providers.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAssistantDir } from "./tower-dir";
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

  // 4. Auto-install hooks and MCP for all available providers
  void ensureProviderIntegrations();

  return assistantDir;
}

/**
 * Build the Tower MCP server config for injection into CLI adapters.
 */
function buildTowerMcpConfig(): McpServerConfig {
  const root = process.cwd().replace(/\\/g, "/");
  return {
    name: "tower",
    command: "npx",
    args: ["tsx", `${root}/src/mcp/index.ts`],
  };
}

/**
 * Install hooks and MCP server config for all registered providers.
 * Uses the CliAdapter interface — each provider handles its own config format.
 * Idempotent — skips providers that already have hooks/MCP installed.
 */
async function ensureProviderIntegrations(): Promise<void> {
  const mcpConfig = buildTowerMcpConfig();

  for (const provider of providerRegistry.getAll()) {
    const adapter = provider.cli?.adapter;
    if (!adapter) continue;

    // Check availability before attempting install
    const available = await adapter.isAvailable();
    if (!available) continue;

    const label = provider.displayName;

    // Install hooks
    try {
      const hooksInstalled = await adapter.isHooksInstalled();
      if (!hooksInstalled) {
        await adapter.installHooks(`http://localhost:3000`);
        console.error(`[init-tower] Installed hooks for ${label}`);
      }
    } catch (err) {
      console.error(`[init-tower] Failed to install hooks for ${label}:`, err);
    }

    // Install MCP
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
