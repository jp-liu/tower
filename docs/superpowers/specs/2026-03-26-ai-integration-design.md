# AI Integration Design — MCP Server + Adapter 执行引擎

**Date:** 2026-03-26
**Status:** Draft

---

## 概述

为 ai-manager 添加两项核心能力：

1. **MCP Server** — 让任何 AI agent 通过标准协议操作项目、任务（增删改查）
2. **Adapter 执行引擎** — 让任务能真正调用 AI agent（Claude Code、Codex 等）执行，并实时流式返回结果

两个需求完全独立，可并行开发。

---

## 需求一：MCP Server + AGENTS.md + SKILL.md

### 目标

让 AI 能操作 ai-manager，不局限于 UI 点击。提供三种访问方式：

| 方式 | 适用场景 |
|---|---|
| MCP Server | AI 通过结构化 tool 调用操作（最可靠） |
| AGENTS.md | AI 在项目目录内工作时了解项目能力 |
| SKILL.md | AI 通过 skill 系统加载操作指南 |

### 1.1 MCP Server

#### 目录结构

```
src/mcp/
├── server.ts              # MCP Server 入口，注册所有 tools
├── tools/
│   ├── workspace-tools.ts # list/create/update/delete workspace
│   ├── project-tools.ts   # list/create/update/delete project
│   ├── task-tools.ts      # list/create/update/move/delete task
│   ├── label-tools.ts     # list/create/delete label, set task labels
│   └── search-tools.ts    # global search
└── index.ts               # stdio 启动入口
```

#### 依赖

- `@modelcontextprotocol/sdk` — 官方 MCP SDK，处理 stdio JSON-RPC 协议

#### 工作方式

- 独立进程，通过 `npx tsx src/mcp/index.ts` 启动
- stdio 模式，AI 工具（Claude Code、Cursor 等）在配置中指向此入口
- 自行实例化 Prisma client（不依赖 Next.js 的 `@/*` 路径别名），和 Next.js 应用共享同一个 SQLite DB
- 每个 tool 用 Zod 定义输入 schema
- MCP Server 启动时执行 `PRAGMA journal_mode=WAL`（在 Prisma `$connect` 后），解决并发写入问题

#### 配置示例

```json
{
  "mcpServers": {
    "ai-manager": {
      "command": "npx",
      "args": ["tsx", "/path/to/ai-manager/src/mcp/index.ts"]
    }
  }
}
```

#### Tool 清单

| Tool | 输入 | 输出 |
|---|---|---|
| `list_workspaces` | 无 | workspace 列表（含 project 数量） |
| `create_workspace` | name, description? | 新 workspace |
| `update_workspace` | workspaceId, name?, description? | 更新后的 workspace |
| `delete_workspace` | workspaceId | 确认 |
| `list_projects` | workspaceId | project 列表 |
| `create_project` | workspaceId, name, gitUrl?, localPath? | 新 project（type 由 gitUrl 自动推断） |
| `update_project` | projectId, name?, gitUrl?, localPath? | 更新后的 project |
| `delete_project` | projectId | 确认 |
| `list_tasks` | projectId, status? | task 列表 |
| `create_task` | projectId, title, description?, priority?, status?, labelIds? | 新 task |
| `update_task` | taskId, title?, description?, priority?, labelIds? | 更新后的 task |
| `move_task` | taskId, status | 更新后的 task |
| `delete_task` | taskId | 确认 |
| `search` | query, category? | 搜索结果 |
| `list_labels` | workspaceId | label 列表 |
| `create_label` | workspaceId, name, color | 新 label |
| `delete_label` | labelId | 确认 |
| `set_task_labels` | taskId, labelIds | 更新后的 task labels |

#### MCP 错误处理

所有 tool 统一错误响应格式：

```json
{ "isError": true, "content": [{ "type": "text", "text": "Workspace not found" }] }
```

常见错误场景：ID 不存在返回 NOT_FOUND、必填字段缺失返回 VALIDATION_ERROR、级联删除前提示影响范围。

### 1.2 AGENTS.md

放在项目根目录，内容包括：

- 项目简介（ai-manager 是什么、能做什么）
- 数据模型概览（Workspace → Project → Task 层级关系）
- 可用的 MCP tools 清单及用法示例
- 直接调用 server actions 的说明（给在项目内编码的 AI 使用）
- 约束规则（如删除 workspace 会级联删除所有 project 和 task）

### 1.3 SKILL.md

放在 `skills/ai-manager/SKILL.md`，内容包括：

- 触发条件（当需要管理项目、任务时）
- MCP Server 配置方式
- 操作示例（创建项目、创建任务、移动任务等完整流程）
- 常用工作流模板（如"创建项目并初始化看板"）

---

## 需求二：Adapter 执行引擎

### 目标

补全 ai-manager 的 AI 执行空缺 — 点击任务执行时真正调用 AI agent，并将输出实时流回前端。借鉴 Paperclip 的 adapter 模式，先支持 Claude Code，保留扩展能力。

### 2.1 目录结构

```
src/lib/adapters/
├── types.ts               # 核心接口定义
├── process-utils.ts       # 进程 spawn、超时、PATH 解析
├── registry.ts            # adapter 注册表
├── claude-local/
│   ├── execute.ts         # spawn claude CLI、env 注入、session resume
│   ├── parse.ts           # 解析 stream-json 输出
│   ├── test.ts            # 环境检测
│   └── index.ts           # 导出 AdapterModule
└── codex-local/           # 后续扩展
    └── ...
```

### 2.2 核心接口

```typescript
interface AdapterModule {
  type: string;
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  testEnvironment(): Promise<TestResult>;
}

interface ExecutionContext {
  runId: string;
  prompt: string;                          // 任务上下文（stdin 传入）
  cwd: string;                             // 项目本地路径
  model?: string;
  sessionId?: string;                      // 上次 session，用于 resume
  instructionsFile?: string;               // 角色 prompt 文件路径
  env?: Record<string, string>;
  timeoutSec?: number;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}

interface ExecutionResult {
  exitCode: number | null;
  summary: string;
  sessionId?: string;
  usage?: { inputTokens: number; outputTokens: number };
  model?: string;
  costUsd?: number;
}
```

### 2.3 Prompt 传递方式

两层分离：

| 层 | 传递方式 | 内容 |
|---|---|---|
| **角色指令** | `--append-system-prompt-file` | agent 角色定义（如前端开发、PM） |
| **任务上下文** | stdin | task title + description + conversation history |

#### Claude Code 调用示例

```bash
claude --print - --output-format stream-json --verbose \
  --append-system-prompt-file prompts/frontend-developer.md \
  --model claude-sonnet-4-6 \
  <<< "任务: 实现用户登录页面\n\n描述: ...\n\n历史对话: ..."
```

#### Codex 调用示例

```bash
codex exec --json - <<< "[instructions content]\n\n任务: 实现用户登录页面..."
```

### 2.4 角色 Prompt 文件体系

```
prompts/
├── product-manager.md     # PM：需求分析、PRD、用户故事
├── frontend-developer.md  # 前端：React/Next.js、UI、样式
├── backend-developer.md   # 后端：API、数据库、业务逻辑
├── code-reviewer.md       # CR：代码审查、质量把关
├── tester.md              # 测试：用例编写、E2E
└── ...                    # 按需扩展
```

**Prompt 管理（CRUD）：**

Prompt 模板作为独立实体管理，不与 label 强绑定：

- 新增 `AgentPrompt` 模型：

```prisma
model AgentPrompt {
  id          String   @id @default(cuid())
  name        String                          // 如 "前端开发"、"产品经理"
  description String?                         // 用途说明
  content     String                          // prompt 内容（Markdown）
  isDefault   Boolean  @default(false)        // 是否为默认 prompt
  workspaceId String?
  workspace   Workspace? @relation(fields: [workspaceId], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

- Server actions：`getPrompts(workspaceId?)`, `createPrompt(data)`, `updatePrompt(id, data)`, `deletePrompt(id)`
- MCP tools：`list_prompts`, `create_prompt`, `update_prompt`, `delete_prompt`
- Settings 页面提供 Prompt 模板管理 UI

**使用流程：**

1. 创建任务时可选择一个默认 prompt（也可不选）
2. 打开任务面板时，自动带出关联的 prompt（如果有）
3. 用户可在执行前手动切换 prompt
4. prompt 内容作为 `--append-system-prompt-file` 传给 CLI（写入临时文件）

### 2.5 数据流

```
用户点击"执行" or 发消息
  → 前端调 sendTaskMessage (server action) 保存用户消息到 DB
  → 前端调 /api/tasks/[taskId]/stream (SSE) 触发 AI 执行
  → 后端从 DB 读 task + project（获取 cwd、上下文）
  → 根据 label/配置选择 prompt 文件
  → 组装 prompt（task title + description + conversation history）
  → registry.get(adapterType) → adapter.execute({ prompt, cwd, instructionsFile, onLog })
  → onLog 回调 → SSE 实时推到前端
  → 完成后写 TaskExecution + TaskMessage(ASSISTANT) 到 DB
  → 更新 task 状态
```

### 2.6 进程生命周期管理

**RunningProcessMap**（内存中，executionId → ChildProcess）：

- 执行前检查该 task 是否已有 RUNNING 状态的 execution，有则拒绝
- 用户点"停止" → 通过 executionId 找到进程 → kill
- SSE 连接断开 → 通过 `request.signal`（AbortSignal）检测 → kill 子进程
- 服务器重启 → 清理孤儿进程（将 DB 中 RUNNING 状态重置为 FAILED）
- 最大并发执行数限制为 3，超出排队等待

### 2.7 Session Resume

- `TaskExecution` 表新增 `sessionId String?` 字段存储 session ID
- 下次执行同一 task 时，查询最近一次成功 execution 的 sessionId
- Claude Code 使用 `--resume <sessionId>` 继续上下文
- 如果 resume 失败（stderr 包含 "unknown session" 或退出码非 0），自动回退到全新 session

### 2.8 环境检测

- Settings → AI Tools 页面调用 `adapter.testEnvironment()`
- 检测：CLI 是否安装、API key 是否配置、能否正常通信
- 显示检测结果和修复建议

### 2.9 现有代码变更

| 文件 | 操作 |
|---|---|
| `src/lib/agent-runner.ts` | 废弃，由 adapter 替代 |
| `/api/tasks/[taskId]/execute` | 改为调用 adapter |
| `/api/tasks/[taskId]/stream` | 去掉 mock，接入真实 adapter + SSE（POST 方式，前端用 fetch） |
| `agent-actions.ts` → `sendTaskMessage` | 去掉 mock 回复，仅保存用户消息 |

#### Prisma Schema 变更（统一迁移）

```prisma
// TaskExecution 新增字段
model TaskExecution {
  // ... 现有字段
  sessionId  String?   // AI session ID，用于 resume
}

// 新增 AgentPrompt 模型
model AgentPrompt {
  id          String   @id @default(cuid())
  name        String
  description String?
  content     String
  isDefault   Boolean  @default(false)
  workspaceId String?
  workspace   Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Task 新增可选关联
model Task {
  // ... 现有字段
  promptId   String?   // 关联的默认 prompt
}
```

### 2.10 代码来源

从 Paperclip 提取（裁剪 Paperclip 专属上下文）：

| 源文件 | 目标 | 处理 |
|---|---|---|
| `adapter-utils/src/server-utils.ts` | `src/lib/adapters/process-utils.ts` | 直接复制，零依赖 |
| `adapter-utils/src/types.ts` | `src/lib/adapters/types.ts` | 精简，去掉 agent/company/runtime |
| `claude-local/src/server/execute.ts` | `src/lib/adapters/claude-local/execute.ts` | 去掉 ~20 行 Paperclip workspace 逻辑 |
| `claude-local/src/server/parse.ts` | `src/lib/adapters/claude-local/parse.ts` | 直接复制 |
| `claude-local/src/server/test.ts` | `src/lib/adapters/claude-local/test.ts` | 直接复制 |

---

## 技术决策

| 决策 | 选择 | 理由 |
|---|---|---|
| MCP 模式 | stdio | 本地工具最简单，不需要 HTTP 服务 |
| SQLite 并发 | WAL 模式 | 支持并发读 + 单写，本地场景够用 |
| Adapter 来源 | 提取 Paperclip | 经过验证、处理了边界情况、零外部依赖 |
| Prompt 传递 | 角色指令(文件) + 任务上下文(stdin) 分离 | 职责清晰，复用性好 |
| 先支持的 adapter | Claude Code | 最常用，Paperclip 实现最成熟 |

---

## 不包含（Out of Scope）

- 多租户/认证（本地单用户工具）
- 计费/成本控制（Paperclip 级别的功能）
- Agent 自主调度/心跳（用户手动触发执行）
- Workspace git worktree 管理
