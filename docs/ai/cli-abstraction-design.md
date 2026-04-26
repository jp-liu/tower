# CLI 抽象层设计

> AI 能力插槽化 — Provider × Mode × Model，用户自选。

## 目标

将 Tower 对 Claude Code CLI 的硬编码依赖抽象为通用接口，使：

1. 终端执行（PTY）支持 Claude / Codex / Gemini 等多种 CLI
2. AI 查询（总结、分析等）支持 CLI 非交互模式或 API 直调
3. 每个 AI 使用场景（插槽）可独立配置 provider + mode + model
4. 新增 provider 无需修改调用方代码

## 架构概览

```
┌──────────────────────────────────────────────────────────┐
│  调用方（agent-actions / claude-session / assistant）       │
│                         │                                 │
│              capability-resolver                          │
│               ┌─────────┴──────────┐                      │
│          resolveCliAdapter    resolveQueryAdapter          │
│               │                    │                      │
│        ProviderRegistry      ProviderRegistry             │
│          ┌────┴────┐          ┌────┴─────┐                │
│     CliAdapter  CliAdapter  QueryAdapter QueryAdapter     │
│     (claude)    (codex)     (api)        (cli -p)         │
└──────────────────────────────────────────────────────────┘
```

## 核心接口

### CliAdapter — PTY 执行层

负责构建 CLI spawn 参数。不持有进程，实际 PTY 创建由 session-store 负责。

**职责边界：** adapter 只负责"怎么拼参数"，不负责执行记录（TaskExecution）的生命周期管理。
调用方（agent-actions.ts）决定是创建新执行记录还是复用旧的——adapter 只根据 `resumeSessionId` / `continueLatest` 映射到对应 CLI 的 flag。

```typescript
interface CliSpawnOptions {
  taskId: string;
  prompt: string;
  cwd: string;
  envOverrides?: Record<string, string>;
  resumeSessionId?: string;
  continueLatest?: boolean;
  worktreePath?: string;
  profileArgs?: string[];
  profileEnvVars?: Record<string, string>;
}

interface CliSpawnResult {
  command: string;
  args: string[];
  env: Record<string, string>;
  initialInput?: string;    // Gemini: spawn 后通过 PTY write 发送
}

interface CliAdapter {
  // spawn 参数构建
  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult;

  // 环境变量构建（provider 特定的 TOWER_* 变量）
  buildEnvOverrides(opts: {
    taskId: string;
    taskTitle: string;
    apiUrl: string;
    callbackUrl?: string;
  }): Record<string, string>;

  // Hook 管理
  installHooks(apiUrl: string): Promise<void>;
  uninstallHooks(): Promise<void>;
  isHooksInstalled(): Promise<boolean>;

  // 能力探测
  isAvailable(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  getModels(): Promise<string[]>;     // async — 部分 CLI 可能需要子进程探测

  // 路径
  getConfigDir(): string;             // ~/.claude/ | ~/.codex/ | ~/.gemini/
  getSettingsPath(): string;          // settings.json | config.toml
  getSessionsDir(): string;           // session 存储目录
}
```

### AiQueryAdapter — AI 查询层

负责发送 prompt 获取结果。两种通用实现：API SDK 调用 / CLI 非交互 spawn。

```typescript
interface AiQueryOptions {
  prompt: string;
  cwd?: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  tools?: string[];
  allowedTools?: string[];
}

interface AiQueryResult {
  content: string | null;
  usage?: { inputTokens: number; outputTokens: number };
}

interface AiQueryChunk {
  type: "text" | "tool_use" | "tool_result" | "error";
  content: string;
}

interface AiQueryAdapter {
  query(opts: AiQueryOptions): Promise<AiQueryResult>;
  queryStream?(opts: AiQueryOptions): AsyncIterable<AiQueryChunk>;

  isAvailable(): Promise<boolean>;
  getModels(): Promise<string[]>;
}
```

`queryStream` 为可选方法。助手聊天插槽在 API 模式下需要流式输出，capability-resolver 会校验所选 adapter 是否支持 streaming，不支持时提示用户。

### 错误类型

```typescript
type AiProviderErrorCode =
  | "CLI_NOT_FOUND"       // CLI 命令不存在
  | "API_KEY_MISSING"     // 环境变量未配置
  | "MODEL_NOT_AVAILABLE" // 所选模型不可用
  | "RATE_LIMITED"        // API 限流
  | "NETWORK_ERROR"       // 网络错误
  | "UNSUPPORTED_MODE"    // provider 不支持所选 mode
  | "SPAWN_FAILED";       // CLI 进程启动失败

class AiProviderError extends Error {
  constructor(
    public code: AiProviderErrorCode,
    public provider: string,
    message: string,
  ) {
    super(message);
  }
}
```

## Provider 定义与注册

### ProviderDefinition

```typescript
interface ProviderDefinition {
  name: string;              // "claude" | "codex" | "gemini"
  displayName: string;       // "Claude Code" | "Codex" | "Gemini CLI"
  agentFieldValue: string;   // TaskExecution.agent 字段值: "CLAUDE_CODE" | "CODEX_CLI" | "GEMINI_CLI"

  cli?: {
    command: string;         // 默认命令名
    adapter: CliAdapter;
  };
  api?: {
    keyEnvVar: string;       // "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY"
    adapter: AiQueryAdapter;
  };
  cliQuery?: {
    adapter: AiQueryAdapter; // CLI 非交互模式 (spawn -p)
  };

  models: {
    cli: string[];
    api: string[];
  };
}
```

### ProviderRegistry

```typescript
class ProviderRegistry {
  private providers = new Map<string, ProviderDefinition>();

  register(provider: ProviderDefinition): void;
  get(name: string): ProviderDefinition | undefined;
  getAll(): ProviderDefinition[];

  getCliAdapter(name: string): CliAdapter | null;
  getQueryAdapter(name: string, mode: "api" | "cli"): AiQueryAdapter | null;
  getAvailableProviders(): Promise<ProviderAvailability[]>;

  // 安全：返回所有已注册 CLI 命令名（用于替代硬编码 ALLOWED_COMMANDS）
  getAllowedCommands(): string[];
}

interface ProviderAvailability {
  name: string;
  displayName: string;
  cli: { available: boolean; version: string | null };
  api: { available: boolean; keyConfigured: boolean };
}
```

## 能力插槽配置

### 数据模型

```prisma
model AiCapabilityConfig {
  id        String   @id @default(cuid())
  slot      String   @unique
  provider  String
  mode      String              // "cli" | "api"
  model     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 插槽定义

| slot | 中文名 | 可用 mode | 说明 |
|------|-------|----------|------|
| `terminal` | 终端执行 | cli only | PTY 交互，无 API 模式 |
| `summary` | 会话总结 | cli / api | 任务停止时生成摘要 |
| `dreaming` | 知识沉淀 | cli / api | 任务完成时深度分析 |
| `analysis` | 项目分析 | cli / api | 导入项目时分析目录 |
| `assistant` | 助手聊天 | cli / api | Tower 内置 AI 助手（API 模式需 streaming 支持） |

### 调用入口 — capability-resolver

```typescript
async function resolveCliAdapter(
  slot: "terminal"
): Promise<{ adapter: CliAdapter; provider: ProviderDefinition; model?: string }>

async function resolveQueryAdapter(
  slot: "summary" | "dreaming" | "analysis" | "assistant"
): Promise<{ adapter: AiQueryAdapter; provider: ProviderDefinition; model?: string }>
```

**校验逻辑：**
- 未配置时使用默认值（claude + cli）
- adapter 不可用时抛出 `AiProviderError`（如 CLI_NOT_FOUND、API_KEY_MISSING）
- model 不在 provider 对应 mode 的模型列表中时抛出 `MODEL_NOT_AVAILABLE`
- assistant 插槽 + API 模式时校验 adapter 是否实现 `queryStream`

## CLI Adapter 差异对照

| 行为 | Claude | Codex | Gemini |
|------|--------|-------|--------|
| prompt 传递 | 尾部参数 | 尾部参数 | PTY 内输入（initialInput） |
| resume | `--resume <id>` | `resume <id>` (子命令) | `--resume <id>` |
| continue | `--continue` | `resume --last` | `--resume latest` |
| 权限跳过 | `--dangerously-skip-permissions` | `--full-auto` | `--yolo` |
| model | `--model` | `--model` / `-m` | `--model` / `-m` |
| hook 配置 | JSON `~/.claude/settings.json` | TOML `~/.codex/config.toml` | JSON `~/.gemini/settings.json` |
| hook 事件名 | PostToolUse | PostToolUse | AfterTool |
| sessionId 来源 | hook stdin `session_id` | hook stdin `session_id` | hook stdin `session_id` |
| 非交互模式 | `claude -p` | `codex exec` | `gemini -p` |
| JSON 输出 | `--output-format json` | `--json` (JSONL) | `--output-format json` |

## AI Query Adapter 实现

### CliQueryAdapter（通用）

根据 provider 配置分发不同 flag，spawn CLI 进程解析 JSON 输出：

```typescript
const CLI_QUERY_CONFIG = {
  claude: { command: "claude", printFlag: "-p", outputFlag: ["--output-format", "json"], modelFlag: "--model" },
  codex:  { command: "codex",  subcommand: "exec", outputFlag: ["--json"], modelFlag: "--model" },
  gemini: { command: "gemini", printFlag: "-p", outputFlag: ["--output-format", "json"], modelFlag: "--model" },
};
```

各家 JSON 输出格式不同，各写一个 `parseResponse()` 函数。

### ApiQueryAdapter（通用）

Built-in provider 使用原生 SDK：

- Claude → `@anthropic-ai/sdk` → `client.messages.create()`
- OpenAI/Codex → `openai` → `client.chat.completions.create()`
- Gemini → `@google/generative-ai` → `model.generateContent()`

用户自定义 provider 统一走 **OpenAI 兼容协议**：

```typescript
// 用户只需提供 baseURL + apiKeyEnvVar + models
new OpenAI({ baseURL: provider.apiBaseUrl, apiKey: process.env[provider.keyEnvVar] })
```

SDK 依赖按需 dynamic import，未安装的不报错，`isAvailable()` 返回 false。

## CliProfile 处理

CliProfile 模型**保留不删除**，职责调整：

- **之前：** 决定用哪个 CLI + 怎么调
- **之后：** 只负责"怎么调"（额外参数、自定义环境变量）
- "用哪个 CLI"由 AiCapabilityConfig 的 terminal 插槽决定
- `command` 字段保持 required，作为 override：非空时覆盖 adapter 默认命令，空字符串或 `"default"` 表示使用 adapter 默认值
- `baseArgs` / `envVars` 合并到 adapter 的 `buildSpawnArgs` 输入中

## 与现有模型的关系

### AgentConfig

`AgentConfig` 管理 per-agent 的行为配置（appendPrompt、settings），与 `AiCapabilityConfig` 职责不同：
- `AiCapabilityConfig` — **路由**：哪个插槽用哪个 provider/mode/model
- `AgentConfig` — **行为**：agent 的 prompt、设置项

两者独立，不合并。

### TaskExecution.agent 字段映射

现有值 `"CLAUDE_CODE"` 保持不变。新 provider 映射：

| provider | TaskExecution.agent |
|----------|---------------------|
| claude | `CLAUDE_CODE` |
| codex | `CODEX_CLI` |
| gemini | `GEMINI_CLI` |

由 `ProviderDefinition.agentFieldValue` 提供。

## 文件结构

```
src/lib/ai/
  ├─ types.ts                          // 接口定义 + AiProviderError
  ├─ provider-registry.ts              // ProviderRegistry 单例
  ├─ capability-resolver.ts            // resolveCliAdapter / resolveQueryAdapter
  ├─ adapters/
  │   ├─ cli/
  │   │   ├─ claude-cli-adapter.ts     // Claude Code 特化
  │   │   ├─ codex-cli-adapter.ts      // Codex 特化
  │   │   └─ gemini-cli-adapter.ts     // Gemini CLI 特化
  │   └─ query/
  │       ├─ api-query-adapter.ts      // 通用 API 模式
  │       └─ cli-query-adapter.ts      // 通用 CLI 非交互模式
  └─ providers/
      ├─ claude.ts                     // Claude ProviderDefinition
      ├─ codex.ts                      // Codex ProviderDefinition
      ├─ gemini.ts                     // Gemini ProviderDefinition
      └─ index.ts                      // registerBuiltinProviders()
```

## 实施阶段

### Phase 1: 基础层 + Claude 迁移（保障现有功能）

1. 定义接口 + 类型 + 错误类型（`types.ts`）
2. 实现 `ClaudeCliAdapter`（从 `agent-actions.ts` 抽取现有逻辑）
   - 包含 `buildSpawnArgs`、`buildEnvOverrides`、`installHooks`、`getSessionsDir` 等
   - 合并 `findClaudeBinary()` 重复逻辑（现分散在 `claude-session.ts` 和 `assistant/chat/route.ts`）
3. 实现 `ProviderRegistry` + `capability-resolver`
4. 新增 `AiCapabilityConfig` 表（Prisma migration）
5. `agent-actions.ts` 改用 `resolveCliAdapter("terminal")`
6. `cli-profile-actions.ts` 的 `ALLOWED_COMMANDS` 改为从 `ProviderRegistry.getAllowedCommands()` 动态获取
7. **全量回归测试确保 Claude Code 功能不变**

### Phase 2: AI 查询迁移

1. 实现 `ApiQueryAdapter`（Claude SDK 先行）
2. 实现 `CliQueryAdapter`（Claude `-p` 模式）
3. `claude-session.ts` 的 `aiQuery()` 改为调 `resolveQueryAdapter()`
4. 各调用点迁移：summary / dreaming / analysis
5. **现有功能回归测试**

### Phase 3: 新 Provider 扩展

1. `CodexCliAdapter` + Codex Provider 注册
2. `GeminiCliAdapter` + Gemini Provider 注册
3. Hook 安装适配（TOML for Codex, JSON for Gemini）
4. API Query 支持（OpenAI SDK, Google GenAI SDK）
5. 扩展 `createSession` 支持 `initialInput` 参数（Gemini PTY 内发送初始 prompt）

### Phase 4: Settings UI

1. 能力插槽配置面板（5 插槽 × provider/mode/model）
2. Provider 可用性检测（CLI 版本、API Key 状态）
3. 缺配置时的提示引导

### Phase 5: 用户自定义 Provider（Future）

1. 新增 Provider 弹窗（名称、API Base URL、Key 环境变量、模型列表）
2. Built-in + User-defined 混合显示
3. 参考 Paperclip 的 skill/plugin 机制

## 约束

- Phase 1-2 完成后功能必须与改造前完全一致
- 不新增 npm 依赖直到 Phase 3（Claude 的 SDK 已有）
- API Key 不存 DB，只从环境变量读取，缺失时提示用户
- `CliProfile` 保留兼容，不做破坏性变更
- `initialInput` 模式（Gemini）需要在 Phase 3 扩展 session-store 的 `createSession`
- `TaskExecution.agent` 字段值由 `ProviderDefinition.agentFieldValue` 驱动
