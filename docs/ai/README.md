# AI 模块

**Slug:** `ai`

## 概述

Tower 的 AI 能力层，涵盖 Claude Agent SDK 集成、CLI Adapter、助手聊天、任务执行、执行总结等。当前仅实现 Claude Code 适配，预留多 CLI 扩展接口。

## AI 能力调用点

| 能力 | 文件 | 调用方式 | 建议模型 |
|------|------|----------|----------|
| 助手聊天 | `api/internal/assistant/chat/route.ts` | Agent SDK `query()` | 当前默认 |
| 小总结 | `lib/claude-session.ts` → `generateSummaryFromLog` | Agent SDK `aiQuery()` | Haiku 4.5 |
| 大总结(Dreaming) | `lib/claude-session.ts` → `generateDreamingInsight` | Agent SDK `aiQuery()` | Sonnet 4.6 |
| 项目分析 | `actions/project-actions.ts` → `analyzeProjectDirectory` | Agent SDK `aiQuery()` | Sonnet 4.6 |
| 任务执行 | `actions/agent-actions.ts` → `startPtyExecution` | PTY spawn CLI | 当前默认 |

## 文件清单

### 核心库

| 文件 | 说明 |
|------|------|
| `lib/claude-session.ts` | AI 统一入口：`aiQuery()`、`generateSummaryFromLog()`、`generateDreamingInsight()` |
| `lib/assistant-sessions.ts` | 助手会话管理（localStorage 注册表） |
| `lib/assistant-constants.ts` | `ASSISTANT_SESSION_KEY` 等常量 |
| `lib/assistant-message-converter.ts` | SDK 消息 → UI 消息格式转换 |
| `lib/build-multimodal-prompt.ts` | 多模态 prompt 构建（文本+图片） |
| `lib/execution-summary.ts` | 执行后摘要和 Dreaming 洞察生成 |
| `lib/cli-test.ts` | CLI Adapter 环境检测 |

### Server Actions

| 文件 | 函数 | 说明 |
|------|------|------|
| `actions/agent-actions.ts` | `startPtyExecution` | 启动 Claude CLI PTY |
| `actions/agent-actions.ts` | `resumePtyExecution` | 恢复会话 |
| `actions/agent-actions.ts` | `continueLatestPtyExecution` | 继续最近会话 |
| `actions/cli-profile-actions.ts` | `getDefaultCliProfile` | 获取活跃 CLI 配置 |
| `actions/prompt-actions.ts` | `getPrompts` / `createPrompt` | Prompt 模板管理 |
| `actions/project-actions.ts` | `analyzeProjectDirectory` | AI 项目分析 |

### API Routes

| 路由 | 说明 |
|------|------|
| `/api/internal/assistant/chat` | 助手聊天 SSE 流式 |
| `/api/internal/assistant/sessions` | 会话消息检索 |
| `/api/internal/assistant/images` | 图片服务 |
| `/api/adapters/test` | CLI Adapter 连接测试 |

### 数据模型

| 模型 | 说明 |
|------|------|
| `CliProfile` | CLI 命令、参数、环境变量配置。`command` 仅允许 `claude`/`claude-code` |
| `AgentConfig` | Agent 特定配置，唯一约束 `(agent, configName)` |
| `AgentPrompt` | Prompt 模板，支持全局/workspace 级别 |
| `TaskExecution` | 执行记录，含 `sessionId`、`summary`、`gitLog`、`insightNoteId` |

### 组件

| 组件 | 说明 |
|------|------|
| `settings/cli-profile-config.tsx` | CLI Profile 配置 UI |
| `settings/cli-adapter-tester.tsx` | CLI 连接测试 UI |
| `settings/prompts-config.tsx` | Prompt 模板管理 UI |
| `settings/ai-tools-config.tsx` | Agent 配置 UI |

## CLI Adapter 接口（TODO）

当前硬编码 Claude Code，后续接入第二个 CLI 时抽象：

```
spawn(cwd, args, env)        — 启动 CLI 进程（PTY）
resume(sessionId)            — 恢复会话
continue()                   — 继续最近会话
getSessionId()               — 获取会话 ID
getHooks() / installHooks()  — Hook 配置注册
buildEnvOverrides(taskId)    — 环境变量注入
```

详细接口清单见 [README.md TODO](../../README.md#todo)。

## 安全约束

- `CliProfile.command` 仅白名单 `claude`、`claude-code`
- `baseArgs` 禁止 shell 元字符 `;&|$()`
- `envVars` 禁止危险 key: `PATH`, `LD_PRELOAD`, `NODE_OPTIONS` 等
- 环境变量通过 `envOverrides` 注入，禁止修改 `process.env`
