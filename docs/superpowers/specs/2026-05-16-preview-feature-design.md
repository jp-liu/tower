# Preview 功能设计文档

**Date:** 2026-05-16
**Status:** Design — pending implementation
**Module:** `preview`

## 1. Goal

把 Tower 现有的"前端 dev server iframe"型预览，升级为**多语言、多场景的开发预览中心**，重点解决两件事：

1. **日志面板**：直接在 Preview UI 里看 dev server 启动 / 运行日志，替代当前 `stdio: "ignore"` 黑盒
2. **框架自动探测**：识别 Vite / Next / Nuxt / Angular / Spring Boot / Django / FastAPI / Flask / Go / Static HTML 等 11 种栈，提供默认命令 / 端口 / 就绪关键字

## 2. Background

### 现状

- `src/components/task/preview-panel.tsx` 是一个固定结构的前端 dev server 预览面板：硬编码 PM 选择器（`pnpm` / `npm` / `yarn`）+ script 输入框 + 端口 + iframe
- `src/lib/preview-process.ts` 用 `child_process.spawn` + `stdio: "ignore"` 启动命令，**日志全丢**
- `src/actions/preview-actions.ts::detectFramework` 仅探测 `vite` / `next` / `nuxt` / `angular` 四种，返回字符串后**没有任何后续使用**
- Schema 已有 `Project.previewCommand` / `Project.previewPort` 两个字段，覆盖范围只够单 app 单技术栈项目

### 痛点

| 场景 | 现状表现 | 用户感受 |
|---|---|---|
| Vite 项目启动失败 | iframe 黑屏 | 不知道哪里挂了，只能再开终端 |
| 想预览 Java Spring Boot 项目 | 没有内置支持 | 自己写命令 + 不知道何时算启动完成 |
| Monorepo（h5 + web + screen 三个子应用） | 同 `previewCommand` 字段，互相覆盖 | 切到另一个 task 配置丢了 |
| 用了 worktree，多个 task 同时预览 | 端口冲突 EADDRINUSE 没提示 | 看不到错误，以为坏了 |

## 3. Scope

### In Scope (V1)

- [x] PTY-based 日志捕获 + 底部抽屉式日志面板（xterm.js 渲染、保留 ANSI 颜色）
- [x] 11 个内置 preset（数据驱动）
- [x] 三档 preset 探测（项目创建时 / Preview Panel 兜底 / 手动 Re-detect）
- [x] 启动就绪信号检测（log regex + HTTP 探活，先到者胜）+ URL 自动提取
- [x] 依赖检测 + 提示横幅（不存在依赖标记时弹 `[Install now] [Run anyway]`）
- [x] Session 共享模型：`(cwd, command, port)` 三元组作为 session 身份
- [x] 利用 `Task.subPath` 自动定位 monorepo 子应用 cwd
- [x] Task-level 覆盖字段（`previewCommandOverride` / `previewPortOverride`）
- [x] 共享 session 的 Stop 确认 dialog（避免误伤其他打开同 preview 的 tab）

### Out of Scope (V2 候选，记入 `project_upcoming_features.md`)

- ❌ 从 `vite.config.ts` / `application.yml` 读 port 作为默认值
- ❌ Preview Profiles（Project 级命名预设）
- ❌ 端口冲突自动避让
- ❌ 多服务编排（前端 + 后端同 task 启动）
- ❌ 用户自定义 preset（Settings UI）
- ❌ 远程 / Docker preview
- ❌ Reverse proxy / API 测试 tab

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│              PreviewPanel + LogDrawer (Client)                     │
│  - Toolbar / Config row / Address bar / iframe / Log drawer        │
│  - WS subscribe → /ws/preview/state/{previewKey}                   │
│  - WS subscribe → /ws/terminal/preview/{previewKey} (xterm stream) │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────────┐
│              Server Actions (preview-actions.ts)                   │
│  getPreviewState / startPreview / stopPreview / installPreviewDeps │
│  redetectPreset / setProjectPreset                                 │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
   ┌───────────────────────┼────────────────────────────┐
   │                       │                            │
┌──▼──────────┐    ┌───────▼────────┐         ┌─────────▼─────────┐
│  presets.ts │    │  detector.ts   │         │  session-store    │
│  (常量数据)  │───▶│  match preset  │         │  Map<key, sess>   │
└─────────────┘    └────────────────┘         └─────────┬─────────┘
                                                        │
                                          ┌─────────────▼─────────────┐
                                          │  PreviewSession           │
                                          │  - PtySession (复用)       │
                                          │  - ring buffer (5000 行)   │
                                          │  - ReadyWatcher           │
                                          │  - subscribers: Set<taskId> │
                                          │  - status / url / readyAt │
                                          └───────────────────────────┘
```

**3 个关键决定**：

1. **复用 `PtySession` 类**（`src/lib/pty/pty-session.ts` 中的 class），但**不复用** `src/lib/pty/session-store.ts`。理由：
   - `pty/session-store.ts:createSession(taskId, ...)` 在入口强制调用 `destroySession(taskId)`，复用会与 Claude PTY 同 taskId 互杀
   - Preview session 用 `previewKey = (cwd, command, port)` 而非 `taskId`，必须新建独立 Map
   - `PtySession` 内置 50KB ring buffer + 单 listener 替换式 `setDataListener` + 可选 idle timer，我们要在外层包一层适配（详见 §7）
2. **新建独立 `src/lib/preview/session-store.ts`**，自己挂 SIGTERM/SIGINT 钩子（用 `globalThis.__previewSignalHandlersRegistered` flag 避免和 Claude PTY 的钩子重复注册）
3. **Session 身份 = (cwd, command, port)**，不是 taskId/projectId

## 5. Data Model

### Schema 改动

```prisma
model Project {
  id                     String   @id @default(cuid())
  // ...existing fields
  previewCommand         String?  // 已有
  previewPort            Int?     // 已有
  previewPreset          String?  // 新增 — preset.id，如 "vite" / "spring-boot-maven"
  previewInstallCommand  String?  // 新增 — install 命令覆盖
}

model Task {
  id                       String   @id @default(cuid())
  // ...existing fields (含 subPath: String?)
  previewCommandOverride   String?  // 新增 — task 级覆盖 Project.previewCommand
  previewPortOverride      Int?     // 新增 — task 级覆盖 Project.previewPort
}
```

Migration 命令：

```bash
pnpm prisma migrate dev --name add-preview-fields
```

零数据迁移（所有新字段 nullable）。

### 5.x Migration & Defaulting Semantics（重要）

历史项目里的 `Project.previewCommand` / `Project.previewPort` 已经存了用户值（旧 PreviewPanel 是 `pnpm/npm/yarn + script` 解析后写入的）。新设计的处理规则：

**T1/T2/T3 探测只写 `previewPreset`，不动 `previewCommand` / `previewPort`**——已存在的用户值视为"用户曾经显式选过的"，不覆盖。

**`getEffectiveCommand` / `getEffectivePort` 优先级 by design**：

```
task.previewCommandOverride
  ?? project.previewCommand     ← 旧用户的历史值进入这一档
  ?? preset.command             ← 新 preset 默认
  ?? "" (fallback)
```

这意味着：旧用户即便 preset 升级了，他们的 `previewCommand` 仍是历史值（如 `pnpm dev`）。这是预期行为——不主动覆盖用户已表达的选择。

**Reset 行为**（UI 上的 `[↺ Reset]` 链接）：

- 在 task 级：清空 `Task.previewCommandOverride` / `Task.previewPortOverride`
- 在 project 级（preset badge 下拉里的额外选项 `Reset to preset default`）：清空 `Project.previewCommand` / `Project.previewPort`
- 两个 Reset 都清后 → 三件套完全靠 preset 默认值 → UI 输入框显示 preset 默认（灰色 placeholder）

**首次创建新项目**（V1 之后）：T1 探测出 preset → `previewPreset` 写入，`previewCommand` / `previewPort` 保持 null → UI 默认显示 preset 的命令/端口（placeholder），用户改才存。

### Preset 类型

```ts
// src/lib/preview/preset-types.ts
export interface PreviewPreset {
  id: string;                    // 唯一标识
  name: string;                  // 显示名
  icon: string;                  // simple-icons:vite 等
  detect: (ctx: DetectContext) => boolean;
  command: string;               // 默认命令
  port: number;                  // 默认端口
  installCommand: string | null; // 装依赖命令，null = 不需要
  installMarker: string[] | null;// 依赖已装的标记目录数组
  readyRegex: RegExp | null;     // 启动就绪日志关键字
  urlExtractRegex: RegExp | null;// 从日志抓 URL
  startTimeoutMs?: number;       // 启动超时，默认 60_000
  docUrl?: string;
}

export interface DetectContext {
  files: Record<string, string | null>; // 文件内容，null = 不存在
  hasDir: (rel: string) => boolean;
}
```

### 11 个 V1 Preset

按优先级从特化到通用排列（first-match-wins）。

| ID | Name | Icon | Detect Rule | Command | Port | Install | InstallMarker | ReadyRegex |
|---|---|---|---|---|---|---|---|---|
| `next` | Next.js | `simple-icons:nextdotjs` | `package.json` 含 `next` 依赖 | `pnpm dev` | 3000 | `pnpm install` | `["node_modules"]` | `Ready in \d+` |
| `nuxt` | Nuxt | `simple-icons:nuxtdotjs` | `package.json` 含 `nuxt` 依赖 | `pnpm dev` | 3000 | `pnpm install` | `["node_modules"]` | `Nuxt .* ready in` |
| `vite` | Vite | `simple-icons:vite` | `package.json` 含 `vite` 依赖 | `pnpm dev` | 5173 | `pnpm install` | `["node_modules"]` | `ready in \d+\s*ms` |
| `angular` | Angular | `simple-icons:angular` | `package.json` 含 `@angular/core` | `pnpm start` | 4200 | `pnpm install` | `["node_modules"]` | `Compiled successfully\|Application bundle generation complete` |
| `spring-boot-maven` | Spring Boot (Maven) | `simple-icons:springboot` | `pom.xml` 含 `spring-boot-starter` | `./mvnw spring-boot:run` | 8080 | `./mvnw dependency:resolve` | `["target"]` | `Started \w+Application in [\d.]+ seconds` (timeout: 120s) |
| `spring-boot-gradle` | Spring Boot (Gradle) | `simple-icons:springboot` | `build.gradle` 或 `build.gradle.kts` 含 `spring-boot` | `./gradlew bootRun` | 8080 | `./gradlew --refresh-dependencies` | `[".gradle"]` | `Started \w+Application in [\d.]+ seconds` (timeout: 120s) |
| `django` | Django | `simple-icons:django` | `manage.py` 存在 | `python manage.py runserver` | 8000 | `pip install -r requirements.txt` | `[".venv", "venv"]` | `Starting development server at` |
| `fastapi` | FastAPI | `simple-icons:fastapi` | `requirements.txt` 或 `pyproject.toml` 含 `fastapi` | `uvicorn main:app --reload` | 8000 | `pip install -r requirements.txt` | `[".venv", "venv"]` | `Application startup complete\|Uvicorn running on` |
| `flask` | Flask | `simple-icons:flask` | `requirements.txt` 含 `flask`（且不含 `fastapi`） | `flask --app app run` | 5000 | `pip install -r requirements.txt` | `[".venv", "venv"]` | `Running on\s+http` |
| `go-generic` | Go | `simple-icons:go` | `go.mod` 存在 | `go run .` | 8080 | `go mod download` | `["go.sum"]` | `null` (靠 HTTP 探活) |
| `static` | Static HTML | `simple-icons:html5` | `index.html` 存在且没 `package.json` / `pom.xml` | `npx serve -l {port} .` | 3000 | `null` (npx 自带) | `null` | `Accepting connections at` |

**`{port}` 占位符**：static 的 command 含 `{port}`，spawn 前用实际端口 `String.replace("{port}", port.toString())` 注入。

**正则表达式备注**：表格里 `readyRegex` 一栏写的是 JS RegExp 字面量（不带 `/.../`），代码里实际定义如：

```ts
readyRegex: /Ready in \d+/i,             // next
readyRegex: /ready in \d+\s*ms/i,         // vite
readyRegex: /Compiled successfully|Application bundle generation complete/i,  // angular
readyRegex: /Started \w+Application in [\d.]+ seconds/i,  // spring-boot-*（兼容 Spring Boot 2.x/3.x）
```

`flask` 的 detect rule 实现为 `/^flask/im.test(requirements)`——配合 first-match-wins 优先级，fastapi 在 flask 之前匹配（fastapi 项目即便 requirements 同时含 flask 也会先命中 fastapi）。

**Preset 加一个字段 `installCwd: "self" | "monorepo-root"`（M-6 引入）**：

```diff
export interface PreviewPreset {
  // ... existing
+ installCwd?: "self" | "monorepo-root";  // 默认 "self"
}
```

- `installCwd: "self"`：在 `effectiveCwd` 跑 install（默认值，单 app 项目）
- `installCwd: "monorepo-root"`：在 `project.localPath` 跑 install（pnpm/yarn workspaces 必须在根目录跑）

V1 的 preset 默认 `installCwd: "self"`。检测到 `package.json` 含 `workspaces` 字段或根存在 `pnpm-workspace.yaml` / `lerna.json` 时，自动把 install 上调到 `project.localPath`。具体实现：

```ts
function getInstallCwd(preset, effectiveCwd, projectLocalPath): string {
  if (preset.installCwd === "monorepo-root") return projectLocalPath;
  // 自动检测 workspace 根
  if (isMonorepoRoot(projectLocalPath) && effectiveCwd !== projectLocalPath) {
    return projectLocalPath;
  }
  return effectiveCwd;
}
```

### 文件结构

```
src/lib/preview/
├── preset-types.ts          # PreviewPreset / DetectContext 类型
├── presets.ts               # 11 个 preset 常量
├── detector.ts              # readPresetFiles + matchPreset 纯函数
├── preview-key.ts           # getPreviewKey + getPreviewCwd 工具
├── session-store.ts         # Map<key, PreviewSession>
├── preview-session.ts       # PreviewSession 类
├── ready-watcher.ts         # 日志正则 + HTTP 探活
├── url-extractor.ts         # 从 PTY 行抓 URL
└── __tests__/

src/actions/preview-actions.ts             # 重构
src/components/task/preview-panel.tsx      # 重构
src/components/task/preview-log-drawer.tsx # 新增

src/lib/preview-process.ts                 # 删除（功能并入新 session-store）
```

## 6. Preset 探测时机

三档触发，覆盖所有情况：

### T1 — 项目创建/更新时（主路径）

`createProject` / `updateProject` 完成后：

```ts
if (project.localPath && readdir(project.localPath).length > 0) {
  const preset = detectPreset(project.localPath);
  if (preset) {
    await db.project.update({
      where: { id: project.id },
      data: { previewPreset: preset.id },
    });
  }
}
```

跳过条件：
- `localPath` 为 null（git 项目本地没 clone）
- `localPath` 是 `mkdir` 出来的空目录
- 探测返回 null（识别不出来）

### T2 — Preview Panel 挂载时（兜底）

```ts
// 在 getPreviewState 内
if (project.previewPreset == null && effectiveCwd) {
  const preset = detectPreset(effectiveCwd);
  if (preset) {
    db.project.update({ where: { id: project.id }, data: { previewPreset: preset.id } })
      .catch(() => {});  // fire-and-forget，不阻塞返回
  }
}
```

覆盖 T1 没扫到的情况（空目录后添代码 / git clone 完才出现文件 / feature 之前已存在的旧项目）。

### T3 — 手动 Re-detect

Preview Panel preset 徽章下拉里的 `↻ Re-detect` 按钮 → 调用 `redetectPreset(projectId)` server action → 强制重扫并覆盖 `Project.previewPreset`。

### T1/T2/T3 之外的特殊路径：subPath

当 task 有 `subPath` 时，**实时探测 subPath 目录**，不存 Task：

```ts
function getEffectivePreset(task, project): PreviewPreset | null {
  if (task.subPath) {
    return detectPreset(path.join(project.localPath, task.subPath));
  }
  return PRESETS.find(p => p.id === project.previewPreset) ?? null;
}
```

理由：monorepo 子应用技术栈互不相同（h5 用 Vite、web 用 Next），但探测本身廉价（<20ms），不需要持久化。

## 7. Session 模型

### Session Key = (cwd, command, port)

```ts
// src/lib/preview/preview-key.ts
type PreviewEffective = {
  cwd: string;
  command: string;
  port: number;
};

function getPreviewKey(eff: PreviewEffective): string {
  return `${eff.cwd}|${eff.command}|${eff.port}`;
}

function getPreviewCwd(ctx: {
  worktreePath: string | null;
  projectLocalPath: string | null;
  subPath: string | null;
}): string | null {
  if (ctx.worktreePath) return ctx.worktreePath;
  if (!ctx.projectLocalPath) return null;
  return ctx.subPath
    ? path.join(ctx.projectLocalPath, ctx.subPath)
    : ctx.projectLocalPath;
}

function getEffectiveCommand(task, project, preset): string {
  return task.previewCommandOverride
      ?? project.previewCommand
      ?? preset?.command
      ?? "";
}

function getEffectivePort(task, project, preset): number {
  return task.previewPortOverride
      ?? project.previewPort
      ?? preset?.port
      ?? 0;
}
```

### Session 共享的三个典型场景

| 场景 | 各 task 的 effective | 结果 |
|---|---|---|
| 单 app 项目，3 个非 worktree task，都没 override | `(~/proj, pnpm dev, 5173)` ×3 | **1 个共享 session** |
| Monorepo h5/web/screen，9 个非 worktree task（subPath 区分） | `(~/proj/apps/h5, pnpm dev, 5173)` ×3 + `(~/proj/apps/web, pnpm dev, 5173)` ×5 + ... | **3 个 session**（h5/web/screen 各一） |
| Worktree task A + B | `(~/wt/A, pnpm dev, 5173)` + `(~/wt/B, pnpm dev, 5173)` | 2 个 session（cwd 不同自动隔离），但**端口冲突，B 启动会失败** |

### `PreviewSession` 状态

```ts
class PreviewSession {
  readonly key: string;  // (cwd, command, port) 合并字符串
  status: "stopped" | "installing" | "starting" | "running" | "error";
  
  private pty: PtySession | null = null;
  private ringBuffer: string[] = [];   // 5000 行（独立于 PtySession 自带的 50KB byte buffer）
  private currentUrl: string | null = null;
  private readyAt: number | null = null;
  private startedAt: number | null = null;
  private errorMessage: string | null = null;
  private readyWatcher: ReadyWatcher | null = null;
  private cancelRequested: boolean = false;  // installing 期间 Stop 标志（C-3）
  
  private outputListeners = new Set<(line: string) => void>();
  private stateListeners = new Set<(state: PreviewState) => void>();
  private subscribers = new Map<string, { taskId: string }>();  // connectionId → { taskId }
  
  async run(opts: RunOptions): Promise<void>;
  async install(opts: InstallOptions): Promise<void>;
  stop(): void;
  
  subscribe(connectionId: string, taskId: string, onState, onOutput): () => void;
  getBuffer(): string[];
  getState(): PreviewState;
  get activeSubscriberCount(): number;  // = subscribers.size（连接数，不是 taskId 数）
  get subscriberTaskIds(): Set<string>;  // 去重后的 taskId 集合
}
```

**Subscribers 用 `connectionId`，不是 `taskId`**（M-4）：

一个 task 可能被同一用户用两个浏览器 tab 同时打开。如果用 `Set<taskId>`，两个 tab 会被去重成 1 个 → Stop dialog 显示 N 错半。改成 `Map<connectionId, ...>`：
- 每次 WebSocket 连接生成一个 uuid 作为 connectionId
- WS 断连时清理对应条目
- `activeSubscriberCount = subscribers.size`（连接数）
- 需要"几个 task 在共看"时用 `subscriberTaskIds`（去重）

### PtySession 复用细节（C-1 详解）

`PreviewSession.run()` 内部实例化 `PtySession`：

```ts
async run(opts: RunOptions): Promise<void> {
  this.cancelRequested = false;
  this.status = "starting";
  this.broadcastState();

  this.pty = new PtySession(
    /* taskId */ this.key,           // PtySession 字段名是 taskId 但我们传 previewKey；它内部只是个 string 标识
    /* command */ opts.cmd,
    /* args */ opts.args,
    /* cwd */ opts.cwd,
    /* onData */ (data) => this.handlePtyData(data),
    /* onExit */ (exitCode) => this.handlePtyExit(exitCode),
    /* envOverrides */ opts.envOverrides,
    /* onIdle */ undefined,          // ❗ 显式 undefined 禁用 idle timer（dev server 可能长时间静默）
    /* idleThresholdMs */ undefined
  );
}
```

**关键约束**（来自 `pty-session.ts` 实现）：
- ❌ **不调用** `pty/session-store.ts:createSession()` — 它会按 taskId 去重 destroy，和 Claude PTY 冲突
- ✅ **直接 `new PtySession(...)`** — 类是 export 的，外部可构造
- ❗ **`onIdle: undefined`** 必传 — dev server 大部分时间静默（只在请求来时输出），不能被 idle timer 杀
- ❗ **`setDataListener` 是单 listener 替换**（pty-session.ts:13、115-117）— PreviewSession 自己维护 `outputListeners: Set`，在 `handlePtyData` 内 fan-out 给所有订阅者
- ❗ **PtySession 默认 cols=80, rows=24**（pty-session.ts:50-51）— 部分 dev server（Angular、Vite warning）在 80 列下强制换行可能影响 readyRegex 匹配；**V1 在 `new PtySession` 后立即 `pty.resize(200, 50)`**（PtySession 暴露 resize 方法）作为缓解

### Session Store

```ts
const sessions = new Map<string, PreviewSession>();

export function getOrCreatePreviewSession(key: string): PreviewSession;
export function getPreviewSession(key: string): PreviewSession | undefined;
export function destroyPreviewSession(key: string): void;
export function destroyAllPreviewSessions(): void;
```

**SIGTERM/SIGINT 钩子注册**（避免重复注册）：

```ts
declare global {
  // eslint-disable-next-line no-var
  var __previewSignalHandlersRegistered: boolean | undefined;
}

if (!globalThis.__previewSignalHandlersRegistered) {
  process.on("SIGTERM", destroyAllPreviewSessions);
  process.on("SIGINT", destroyAllPreviewSessions);
  process.on("SIGHUP", destroyAllPreviewSessions);
  globalThis.__previewSignalHandlersRegistered = true;
}
```

参考 Tower 现有 `pty/session-store.ts` 的钩子模式。Claude PTY 和 Preview 各自的 destroyAll 函数并存运行，不冲突。

### Session Store

```ts
const sessions = new Map<string, PreviewSession>();

export function getOrCreatePreviewSession(key: string): PreviewSession;
export function getPreviewSession(key: string): PreviewSession | undefined;
export function destroyPreviewSession(key: string): void;
export function destroyAllPreviewSessions(): void;

process.on("SIGTERM", destroyAllPreviewSessions);
process.on("SIGINT", destroyAllPreviewSessions);
```

## 8. State Machine

```
        ┌──── installPreviewDeps() ────────────────────┐
        │                                                │
        │                                                ▼
   ┌─────────────┐                            ┌──────────────┐
   │   stopped   │                            │  installing  │
   │             │  ◀── install 失败（exit ≠ 0 且 ! cancelRequested）│
   │             │ ◀──────────────────────────│              │
   │             │  ◀── stopPreview()（cancelRequested = true）│
   │             │ ◀──────────────────────────│              │
   │             │                            └──────────────┘
   │             │                                    │
   │             │  install 成功 (exit=0) +           │
   │             │  autoStartAfter + !cancelRequested │
   │             │  ◀─────────────────────────────────┘
   │             │
   │             │  startPreview()             ┌──────────────┐
   │             │ ───────────────────────────▶│   starting   │
   │             │                              │              │
   │             │  ◀── stopPreview()           │              │
   │             │  ◀── PTY 退出 / 超时 → error │              │
   │             │                              └──────────────┘
   │             │                                    │
   │             │  ready 信号触发                    ▼
   │             │  (regex 或 HTTP 200，先到者)
   │             │                              ┌──────────────┐
   │             │                              │   running    │
   │             │  ◀── PTY 退出 → error        │              │
   │             │                              │              │
   │             │  stopPreview()               │              │
   │             │ ◀────────────────────────────│              │
   └─────────────┘                              └──────────────┘
        ▲                                              
        │           ┌──────────────┐                  
        │           │    error     │                  
        │           │              │                  
        │           │ - 启动超时   │                  
        └───────────│ - PTY 崩溃   │                  
                    │ - install 败 │                  
                    └──────────────┘                  
                            │
                            │ 再次 startPreview()
                            ▼ (回到 starting)
```

**关键规则**：

- `running` 时 PTY 进程退出 → status = `error`，errorMessage = "Process exited unexpectedly"
- 装依赖中 → `installing`，不能并行点 Run；Run 时若 `installing` 中 → server action 返回 `{ started: false, error: "Install in progress" }`
- 启动超时（`preset.startTimeoutMs ?? 60_000`）→ 进 error，**PTY 不杀**
- 用户切换 preset / 改命令 → 不强制重启，保留当前 running 直到下次手动 Run

**C-3: installing 期间 cancel 处理**：

- `stopPreview()` 在 `installing` 期间调用 → 设置 `cancelRequested = true`，然后 `pty.kill("SIGTERM")`
- PTY 退出回调 (`handlePtyExit`) 内部判断：
  - `cancelRequested == true` → 进 `stopped`，不报错，**不触发 autoStartAfter**
  - `cancelRequested == false` 且 `exitCode !== 0` → 进 `error`，errorMessage 包含 ring buffer 最后几行
  - `cancelRequested == false` 且 `exitCode === 0` 且 `autoStartAfter` → 自动调用 `run()`
- UI 上 installing 期间 Stop 按钮文案改为 `Cancel install`

## 9. Ready Watcher

```ts
// src/lib/preview/ready-watcher.ts
export class ReadyWatcher {
  constructor(
    private preset: PreviewPreset | null,
    private port: number,
    private timeoutMs: number,
    private onReady: (url: string | null) => void,
    private onTimeout: () => void
  ) {}

  start(): void {
    // 1. 设置 timeout 定时器
    // 2. 启动 HTTP probe（每 500ms HEAD localhost:{port}）
    //    200/204/3xx → onReady(null)
    // 3. 等待 feedLine 命中 preset.readyRegex
    //    命中 → onReady(extractedUrl ?? null)
    // 任一信号触发 → 内部 ready 标志置位，后续信号忽略
  }

  feedLine(line: string): void {
    if (this.ready) return;
    if (this.preset?.readyRegex?.test(line)) {
      const url = this.preset.urlExtractRegex?.exec(line)?.[1] ?? null;
      this.emitReady(url);
    } else if (this.preset?.urlExtractRegex) {
      // 即便没匹配 readyRegex，先抓 URL 留着，HTTP 探活时用
      const url = this.preset.urlExtractRegex.exec(line)?.[1];
      if (url) this.pendingExtractedUrl = url;
    }
  }

  stop(): void { /* clear timer + probe */ }
}
```

ANSI 颜色 strip：`feedLine` 内部先用 `strip-ansi` 处理，正则就能匹配带颜色的输出。

**URL Fallback 规则**（N-6）：

`onReady(url)` 中的 `url` 可能是 `null`（如 Spring Boot / Go 没有 `urlExtractRegex`、HTTP 探活先命中也只返回 null）。`PreviewSession.handleReady` 处理：

```ts
private handleReady(extractedUrl: string | null): void {
  this.currentUrl = extractedUrl ?? `http://localhost:${this.port}/`;
  this.status = "running";
  this.readyAt = Date.now();
  this.broadcastState();
}
```

UI 收到 state 中的 `url` 字段后直接塞 iframe `src`（永远是非 null 字符串）。

## 10. Server Actions API

```ts
"use server";

// 1. 读取状态（Panel 挂载时）
export async function getPreviewState(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
}): Promise<{
  previewKey: string;
  status: "stopped" | "installing" | "starting" | "running" | "error";
  preset: { id: string; name: string; icon: string; docUrl?: string } | null;
  presetSource: "project" | "subPath-detected" | null;
  command: string;              // effective
  port: number;                  // effective
  installCommand: string | null;
  url: string | null;
  installed: boolean | null;
  startedAt: number | null;
  readyAt: number | null;
  errorMessage: string | null;
  recentLogs: string[];          // ring buffer 最近 500 行
  activeSubscribers: number;
  cwd: string | null;
}>;

// 2. 启动 preview
// M-1: 在 spawn 之前先用 net.createServer().listen(port) 探测端口可用性，
//      占用则直接返回 { started: false, error: "Port X is in use. Set Task.previewPortOverride to use a different port." }
//      不进 starting 状态，避免 60s 超时浪费用户时间
export async function startPreview(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
}): Promise<{ started: boolean; error?: string }>;

// 3. 停止
// C-3: 在 installing 状态时调用 → 设置 cancelRequested、kill install PTY，不进 error
//      在 running/starting 状态时调用 → 直接 kill dev server PTY
export async function stopPreview(args: {
  previewKey: string;
}): Promise<void>;

// 4. 装依赖
export async function installPreviewDeps(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
  autoStartAfter?: boolean;
}): Promise<{ ok: boolean; error?: string }>;

// 5. 重新探测 preset
export async function redetectPreset(args: {
  projectId: string;
  worktreePath?: string | null;
}): Promise<{ preset: string | null }>;

// 6. 手动切换 preset
export async function setProjectPreset(args: {
  projectId: string;
  presetId: string | null;
}): Promise<void>;

// 7. 现有 openInTerminal 保留
```

`updateTask` / `updateProject` 扩展支持新字段（`previewCommandOverride`, `previewPortOverride`, `previewPreset`, `previewInstallCommand`）。

## 11. WebSocket 协议

**WS 路由架构**（N-5）：

`src/lib/pty/ws-server.ts` 当前有单个 `wss` instance 在端口 3001（`terminal.wsPort` 配置），按 path 前缀分发到 Claude PTY handler。Preview 复用**同一 wss + 同一端口**，在 `onConnection` 内增加路径前缀判断：

```
/ws/terminal/{taskId}                 # 已有 — Claude PTY
/ws/terminal/preview/{previewKey}     # 新增 — Preview PTY 输出流（给 xterm.js 渲染）
/ws/preview/state/{previewKey}        # 新增 — 状态广播
```

Query string 携带 `?connectionId={uuid}&taskId={taskId}`，服务端把 `connectionId` 加入 session 的 `subscribers` Map，WS close 时移除。

**Output 帧格式**（`/ws/terminal/preview/{previewKey}`）：

复用 Claude PTY 现有约定 — 服务端发**原始 UTF-8 字符串**（PTY raw output，含 ANSI），客户端 xterm.js `term.write(data)` 直接渲染。同时支持上行帧 `{ type: "ready" }`（客户端就绪后服务端 flush ring buffer 中所有积累的字节）。

**State 帧格式**（`/ws/preview/state/{previewKey}`，完整 schema — M-3）：

```ts
type PreviewStateFrame = {
  type: "state";
  previewKey: string;
  state: {
    status: "stopped" | "installing" | "starting" | "running" | "error";
    presetId: string | null;              // 当前 preset，切换或 re-detect 后更新
    presetSource: "project" | "subPath-detected" | null;
    command: string;                       // effective
    port: number;                          // effective
    url: string | null;                    // ready 后的实际 URL（提取或 fallback）
    installCommand: string | null;
    installed: boolean | null;             // 装完依赖后变 true，UI 隐藏 banner
    startedAt: number | null;              // epoch ms
    readyAt: number | null;
    errorMessage: string | null;
    activeSubscribers: number;             // = subscribers.size（连接数）
    subscriberTaskIds: string[];           // 去重后的 task 列表（UI 提示用）
  };
};
```

每次 status / url / readyAt / errorMessage / installed 任一变化都广播一次。客户端 setState 全量替换。

## 12. UI 结构

```
PreviewPanel
├── Toolbar (header-sm = 44px)
│   ├── [Status pill]                           # stopped/installing/starting/running/error 五色
│   ├── [Preset badge with icon + dropdown]     # 含 Re-detect / 切换 preset / Clear
│   ├── [Run / Stop / Starting...] button
│   ├── [Command input] (默认/Override)         # 显示 "(override)" 徽标 + Reset 链接
│   ├── [Port input]
│   ├── [Address bar]
│   ├── [Refresh button]
│   └── [Open in terminal button]
├── Error banner (条件渲染)
├── iframe (flex-1)
└── LogDrawer
    ├── Install prompt banner (条件渲染)
    │   └── "Dependencies not detected. [Install now] [Run anyway]"
    ├── Collapsed view (header-sm = 1 row)
    │   ├── ▲ icon (toggle expand)
    │   ├── Latest log line (ANSI strip 后 truncate，避免 ANSI 序列中间截断渲染崩坏)
    │   └── [Clear] [Copy] [Fullscreen]
    └── Expanded view (33% of remaining height)
        └── xterm.js (复用现有渲染)
```

**关键交互**：

- 折叠/展开规则：
  - 点 Run → 自动展开
  - ready 信号触发后 3s → 自动收起
  - error 状态 → 自动展开
  - 用户手动开/关后 30s 内不被覆盖（"用户意图优先"）
- Run/Stop 按钮 tooltip：
  - 独占 session → 无说明
  - 共享 session → "Shared with N other open tabs"
- Stop dialog（仅共享 session）：
  - 标题："Stop preview?"
  - 内容："This will stop preview for N other open tabs."
  - 按钮：Cancel / Stop
- Preset badge dropdown 内容：
  - 11 个 preset 列表（含图标）
  - 分隔线
  - `↻ Re-detect`
  - `× Clear (Unknown)`
- Override 视觉提示：
  - Command input 有 override → 输入框右侧 `(override)` 灰色徽标
  - 旁边 `[↺ Reset]` 链接，点了清空 override 字段
- 装依赖横幅：仅当 preset 有 `installCommand` 且 `installMarker` 全不存在时显示

## 13. State Sync

多 client 看同 session 的状态一致性：

```
client A 点 Run
  ↓ startPreview()
session 进 starting
  ↓ session.broadcastState()
  ├─ client A:  WS receive → setStatus("starting")
  ├─ client B:  WS receive → setStatus("starting") + iframe 重新加载
  └─ client C:  WS receive → setStatus("starting")

  ↓ ready 信号
session 进 running
  ↓ broadcastState()
  └─ 三个 client 同步切到 running，iframe 切到实际 URL
```

订阅生命周期：

```ts
useEffect(() => {
  const ws = new WebSocket(`/ws/preview/state/${previewKey}?taskId=${taskId}`);
  ws.onmessage = (e) => setState(JSON.parse(e.data).state);
  return () => ws.close();
}, [previewKey, taskId]);
```

## 14. Testing

### Unit Tests (Vitest)

```
src/lib/preview/__tests__/
├── detector.test.ts        # 11 preset 各自匹配 + 优先级冲突 + 文件 IO 失败
├── presets.test.ts         # readyRegex / urlExtractRegex 对真实日志样本验证
├── ready-watcher.test.ts   # 单/双信号触发、超时、stop 清理
├── url-extractor.test.ts   # ANSI 包裹 / 多 URL / 边界
├── preview-key.test.ts     # 同三元组同 key / cwd 拼 subPath / worktree 隔离
└── preview-session.test.ts # 状态机转移 / ring buffer / subscribers
```

### Integration Tests

```
tests/integration/preview/
├── session-store.test.ts        # spawn 真实进程（mock-dev-server fixture）
├── preview-actions.test.ts      # server action 全链路
└── fixtures/mock-dev-server/    # 模拟 dev server，输出 "ready in 12 ms" 后 listen
```

### E2E Tests (Playwright)

```
tests/e2e/preview.spec.ts
├── 启动 Vite fixture → 等 running → 验证 iframe src
├── 切换日志抽屉 → 验证至少一行日志
├── Stop 后状态正确 → 重开 panel 状态恢复
└── 共享 session：开两个 task → Stop 弹 dialog
```

### Coverage 目标

80%+（与 Tower 项目整体一致）。

## 15. Phase Breakdown

5 个 phase，每个独立可 ship、可 review、可 merge。

### Phase 1: Schema + Preset 数据层

- Prisma migration（Project + Task 加字段）
- `preset-types.ts` / `presets.ts` / `detector.ts`
- 单元测试（detector、presets readyRegex 样本验证）

**完成标志**：`pnpm test` 全过；`pnpm prisma migrate dev` 无错。

### Phase 2: Session Store + Server Actions

- `preview-session.ts` / `session-store.ts` / `ready-watcher.ts` / `url-extractor.ts` / `preview-key.ts`
- 重写 `preview-actions.ts`
- 集成测试（mock-dev-server fixture）
- 删除旧 `src/lib/preview-process.ts`

**完成标志**：单独跑 server action 能启停 mock dev server，state machine 转移正确。

### Phase 3: 探测时机接入

- `createProject` / `updateProject` 后挂 T1 探测
- `getPreviewState` 内嵌 T2 兜底逻辑
- `redetectPreset` action 暴露 T3
- subPath 实时探测

**完成标志**：
- 创建 vite fixture 项目 → DB `previewPreset = "vite"`
- 创建空目录项目 → previewPreset null
- 后续打开 preview → T2 自动补全
- subPath 不同的 task 看到不同 preset

### Phase 4: UI 重写

- `preview-panel.tsx` 重构（toolbar / preset badge / override 字段）
- 新增 `preview-log-drawer.tsx`（xterm + 折叠态 + 装依赖横幅）
- 新增 `stop-preview-confirm-dialog.tsx`
- 接入 `@iconify/react`
- WS 订阅 state 流
- 国际化（zh/en 双语 key）

**完成标志**：手工开 task → preset 自动识别 → Run → 日志流式 → ready 自动收起 → Stop 正常。

### Phase 5: E2E + 文档

- Playwright preview.spec.ts
- `docs/modules/` 加 preview 模块文档
- 更新 `AGENTS.md`（新 actions 签名）
- 更新 `.claude/rules/process-lifecycle.md`（preview PTY 长 lived）

**完成标志**：E2E 全过；docs 校验通过；CHANGELOG 加条目。

### Phase 间 commit 边界

每个 phase 一个 atomic merge commit，commit message 用 `feat(preview-XX.YY): ...` 格式（XX = phase 编号，YY = sub task 编号），符合 Tower commit 规范。

## 16. Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| node-pty 跨平台不一致（Windows ConPTY） | 启动失败 / ANSI 异常 | 已有 PTY 基建踩过；CI Linux + macOS 双跑 |
| 端口已被占用 | dev server EADDRINUSE 自己 exit | startPreview 内 spawn 前 net 模块预探活（M-1）；占用直接返回错误，不进 starting |
| install 中途用户切走 | install PTY 还在跑 | install 也长 lived；切回来继续看；点 Stop 杀（C-3 cancel 处理）|
| detector 读文件 race | 偶发返回错 | catch JSON 错误；降级 null（Unknown），UI 引导手动设 |
| iframe X-Frame-Options 拒载 | 后端默认禁 iframe 黑屏 | 地址栏旁加 "Open in new tab" 按钮 |
| HTTP 探活打扰 dev server | 日志多几行 200 OK | 仅 starting 期间探活；running 后停 |
| Ring buffer 不够 | 长日志被丢 | 5000 行 ≈ 500KB 实测够；后续可配置 |
| 多 task 同端口（worktree 模式） | 后启失败 | M-1 端口预探活直接报错；用户改 port（V2 自动避让候选） |
| PTY 残留（Node 崩溃） | 子进程未杀 | SIGTERM/SIGINT/SIGHUP 钩子注册（用 globalThis flag 防重）；仿照 `pty/session-store.ts:62-73` 模式 |
| WS 重连/订阅泄漏 | 长开 panel 内存增长 | useEffect cleanup 严格关 WS；session.unsubscribe 务必调用；subscribers 用 connectionId 区分 |
| **PTY 默认 cols=80 太窄**（M-6 新增） | Vite / Angular 启动日志在 80 列下强制换行，可能打断 readyRegex 匹配 | `PreviewSession.run()` 内构造 PtySession 后立即 `pty.resize(200, 50)` |
| **monorepo install cwd 错位**（M-6 新增） | 在 `apps/h5` 子目录跑 `pnpm install` 失败或装到错地方 | preset 加 `installCwd` 字段；自动检测 workspace root（`pnpm-workspace.yaml` / 根 package.json 含 `workspaces`）→ 把 install 上调到 `project.localPath` |
| **macOS UTF-8 cwd 编码**（M-6 新增） | node-pty cwd 含中文/特殊字符可能解码错 | 已验证：node-pty 默认 UTF-8 cwd 在 macOS 工作正常；CI 加一个含中文路径的 fixture 用例 |
| T2 探测并发 race（M-2） | 多 tab 同时 panel mount → 多次 update Project.previewPreset | T2 用 conditional update `where: { id, previewPreset: null }` 保证 first-write-wins |

## 17. Open Questions

无——所有设计点都已和用户对齐。

### 17.x Phase 1 起手前必做的 grep

```bash
grep -rn "preview-process\|registerPreviewProcess\|killPreviewProcess\|isPreviewRunning" \
  src --include="*.ts" --include="*.tsx"
```

确认除 `preview-actions.ts` 外没有其他 importer（reviewer 确认目前确实只有它一处）。Phase 2 删除 `preview-process.ts` 前再 grep 一次防患。

## 18. Acceptance Criteria

V1 验收时，以下场景全部能通：

1. **单 app 前端项目**：创建 vite 项目 → 自动识别为 vite → Run → 日志流式 → ready 后 iframe 显示
2. **单 app 后端项目**：创建 Spring Boot Maven 项目 → 识别为 spring-boot-maven → 横幅提示装依赖 → 点 Install → 装完自动 Run → 启动 8080 → iframe 显示（fallback 到 localhost:8080）
3. **静态项目**：项目里只有 index.html → 识别为 static → Run 通过 `npx serve` → iframe 显示
4. **Monorepo**：项目下 `apps/h5` + `apps/web`，分别建 task 用 subPath 区分 → 每个 task 探测自己 subPath 的 preset → 同 subPath 多 task 共享 session
5. **Worktree mode**：worktree task 独立 session；多 worktree task 默认端口冲突时显示错误日志，用户改 port 后正常
6. **共享 session Stop**：3 个非 worktree task 共看一个 session → 一个 task 点 Stop → 弹 dialog → 确认后三个 task 都变 stopped
7. **错误处理**：启动超时 60s → 进 error，errorMessage 包含日志最后几行
8. **状态恢复**：Run 后关 task 详情页 → 重开 → 状态仍是 running，日志和 iframe 都恢复（PTY 长 lived）
9. **Re-detect**：用户 Vite 迁 Next → 点 Re-detect → preset 更新为 next
10. **Override**：用户改命令为 `pnpm dev:full` → 存到 Task.previewCommandOverride → 三件套变化 → session key 变化 → 独立 session 或合并到匹配的现有 session

---

## Appendix A: 文件变更清单

```
新增:
+ prisma/migrations/<timestamp>_add_preview_fields/migration.sql
+ src/lib/preview/preset-types.ts
+ src/lib/preview/presets.ts
+ src/lib/preview/detector.ts
+ src/lib/preview/preview-key.ts
+ src/lib/preview/session-store.ts
+ src/lib/preview/preview-session.ts
+ src/lib/preview/ready-watcher.ts
+ src/lib/preview/url-extractor.ts
+ src/lib/preview/__tests__/*
+ src/components/task/preview-log-drawer.tsx
+ src/components/task/stop-preview-confirm-dialog.tsx
+ tests/integration/preview/*
+ tests/e2e/preview.spec.ts
+ tests/fixtures/mock-dev-server/index.js

改动:
~ prisma/schema.prisma                       # Project + Task 加字段
~ src/actions/preview-actions.ts             # 全重构（旧 API 替换）
~ src/actions/workspace-actions.ts           # createProject/updateProject 触发 T1
~ src/actions/task-actions.ts                # updateTask 加 previewCommandOverride/PortOverride 参数
~ src/components/task/preview-panel.tsx      # 全重构
~ src/lib/pty/ws-server.ts                   # 加 /ws/preview/* 路由
~ src/lib/i18n/zh.ts + en.ts                 # 新 key
~ docs/modules/preview.md                    # 新文档
~ AGENTS.md                                  # 新 actions 签名
~ .claude/rules/process-lifecycle.md         # 添加 preview PTY 长 lived 条目
~ package.json                               # 加 @iconify/react 依赖

删除:
- src/lib/preview-process.ts                 # 功能并入新 session-store
- tests/unit/lib/preview-process-manager.test.ts
```

## Appendix B: 依赖新增

```json
{
  "@iconify/react": "^5.x"
}
```

预计 bundle 增量：~5KB（运行时）+ 按需 HTTP 加载图标 SVG。

