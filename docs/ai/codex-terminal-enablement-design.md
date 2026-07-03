# Codex 终端启用 — 设计文档

> 状态：待 codex 审查
> 作者：Claude（自动会话，2026-07-02）
> 目标：把已具备的「AI 能力插槽化」地基接通到底，让 **Codex CLI 作为终端 provider 端到端可用**。

## 0. 一句话结论

「AI 能力插槽化」的地基（抽象层 + DB + resolver + terminal 接线）**已基本就绪**；用户当初搁置的三个阻塞点（没 codex、无 apitoken、hooks 未验证）**现已全部解除**。剩下的是一段**收尾**工作：修正盲写的 Codex 适配器、补一个插槽指派 UI，让 Codex 真正能被选进 terminal 插槽跑起来。

---

## 1. 现状审计（基于当前 main + 本机实测）

### 1.1 抽象层地基 — 已就绪

| 组件 | 文件 | 状态 |
|------|------|------|
| 接口/类型/错误 | `src/lib/ai/types.ts` | ✅ 完整 |
| Provider 注册表 | `src/lib/ai/provider-registry.ts`、`providers/index.ts` | ✅ 已注册 claude + codex |
| 能力解析器 | `src/lib/ai/capability-resolver.ts` | ✅ `resolveCliAdapter` 已用；`resolveQueryAdapter` 定义但**零调用** |
| Claude CLI 适配器 | `adapters/cli/claude-cli-adapter.ts` | ✅ 生产在用 |
| Codex CLI 适配器 | `adapters/cli/codex-cli-adapter.ts` | ⚠️ 盲写，见 §2 |
| DB 模型 | `AiCapabilityConfig`、`ProviderConnection` | ✅ 已存在（schema.prisma:313 / :350） |
| 配置 actions | `src/actions/ai-config-actions.ts` | ✅ `getAiCapabilityConfigs` / `updateAiCapabilityConfig`（含连接门控） |
| Test Connection | `src/app/api/adapters/test/route.ts` + `src/lib/cli-test.ts` | ✅ 测试→安装→写 ProviderConnection |
| 安装编排 | `src/lib/ai/install-orchestrator.ts` | ✅ MCP(cli)/Hooks(file)/Skill(symlink) |

### 1.2 消费侧接线现状

| 插槽 | 消费点 | 接线状态 |
|------|--------|---------|
| **terminal** | `src/actions/agent-actions.ts:529` `resolveCliAdapter("terminal")` → `buildSpawnArgs`（:697）；resume/continue（:198/:345）；`assistant-actions.ts:27` | ✅ **已完全接线抽象层** |
| summary | `src/lib/claude-session.ts:aiQuery`（execution-summary.ts:212） | ❌ 硬编码 Claude SDK |
| dreaming | `claude-session.ts:aiQuery`（execution-summary.ts:274） | ❌ 硬编码 |
| analysis | `project-actions.ts:218` → `aiQuery` | ❌ 硬编码 |
| assistant | `src/app/api/internal/assistant/chat/route.ts:172/348` `@anthropic-ai/claude-agent-sdk` | ❌ 硬编码 |

> 关键：terminal 已通，所以 **Codex 终端只差「修适配器 + 能选中」**，不需要改任何消费点。四个 query 插槽全部绕过抽象层直连 Claude SDK。

### 1.3 Settings UI 现状

- 有「AI Tools」区（`settings-page.tsx:1149`）：列 `getAvailableProviders()`、Test Connection、Set Default。
- **没有**「能力插槽指派」面板：`getAiCapabilityConfigs`/`updateAiCapabilityConfig` 后端就绪但**无任何前端 import**。→ 用户当前无法把 codex 指派给 terminal 插槽（除非手改 DB）。

### 1.4 本机实测（codex-cli 0.142.5，2026-07-02）

| 项 | 结果 | 对方案的意义 |
|----|------|-------------|
| codex 安装 | `codex-cli 0.142.5` @ `~/.local/bin/codex` | ✅ 具备 |
| 认证 | `Logged in using ChatGPT`，`OPENAI_API_KEY` **未设** | ✅ **「无 apitoken」已解**：CLI/PTY 路径无需 key，`getApiKeyInfo().required=false` 已正确 |
| hooks 特性 | `codex features list` → `hooks  stable  true` | ✅ 稳定特性 |
| hooks 实际状态 | config.toml 已有 `[features] codex_hooks=true` + `[hooks.state]`；`~/.codex/hooks.json` 为 Tower 写入的 PascalCase（SessionStart/PostToolUse/Stop），**codex 已接受并生成 state** | ✅ **adapter 的 hook 格式在 0.142.5 上实测有效** |
| `codex resume <id>` / `resume --last` | `codex resume [SESSION_ID] [PROMPT]`，`--last` continue | ✅ 与 adapter 一致 |
| `codex mcp add <name> --env -- <cmd>` | 语法一致 | ✅ 与 adapter 一致 |
| `codex exec --json -m <model>` | 存在；另有 `--output-schema` / `-o/--output-last-message` | ✅ 未来 cliQuery 可用 |
| **`--full-auto`** | **不存在**；权限跳过是 `--dangerously-bypass-approvals-and-sandbox` | ❌ **adapter fresh-start 会崩** |
| 模型列表 | 真实 `gpt-5.5` / `gpt-5.4` / `gpt-5.4-mini`（`models_cache.json`）；adapter 写死 `o4-mini/o3/gpt-4.1` | ❌ adapter 列表过时 |

---

## 2. Codex 适配器的真实 bug（盲写 vs 0.142.5）

1. **`--full-auto` 不存在（P0，阻塞）** — `codex-cli-adapter.ts:32` fresh-start `args.push("--full-auto")`。真实 CLI 无此 flag，PTY 一启动 codex 报未知参数直接退出。
   - 修法：改用 `--dangerously-bypass-approvals-and-sandbox`（对齐 Claude adapter 的 `--dangerously-skip-permissions` 语义，见 §2.5 决策 D1）。
2. **resume 路径同样坏（P1，codex 审查发现）** — `codex-cli-adapter.ts:24` resume 分支提前返回，只有 `resume <id>` / `resume --last`，**不带自治标志、不带 `extraArgs`**。对照 `claude-cli-adapter.ts:20-26`：Claude 先无条件拼 `--dangerously-skip-permissions` + `extraArgs`，**再**进 resume/continue/fresh 分支。Codex 必须照此结构，否则 resume 出来的会话会卡审批、丢 `--model` 等 extraArgs。
   - 修法：把全局标志（bypass）+ `extraArgs` 提到分支之前，与 Claude 一致。resume 分支**不追加 prompt**（终端 resume 是交互式续跑，与 Claude 一致）。
3. **模型列表过时（P1）** — `CODEX_MODELS`（:15）与 `providers/codex.ts:15` 均为旧 OpenAI 模型名。**决定：置空数组**（见 §2.5 决策 D2）。codex 不传 `-m` 时用账号默认；resolver 仅在列表非空时校验 model，空列表即避免误报「模型不可用」。
4. **hook 事件名大小写** — adapter 写 PascalCase，实测 codex 已接受（config.toml 生成了 `[hooks.state]`）。**无需改**，仅记录 + 顺手把 adapter 里 "Codex CLI 1.x" 过时注释更正为 0.142.x。
5. **hello probe stdin（codex 审查提出，经查非 bug）** — `codex exec` 会读 stdin，未关会挂（本机实测：裸 shell 里 `codex exec "x"` 卡在 "Reading additional input from stdin..."）。但 Tower 的 probe 走 `cli-test.ts` 的 `runProcess`，`stdio: [..."ignore"..., "pipe","pipe"]`（probe 不传 stdin → stdin=`ignore`=/dev/null 已关）→ **不会挂，无需改**。终端 PTY 路径 stdin 是 TTY（交互模式），也不受影响。仅记录该坑，防未来有人给 probe 加 stdin 时踩雷。

---

## 2.5 Codex 审查结论与采纳（2026-07-02，codex-cli 0.142.5, medium effort）

把设计文档 + 两个 adapter 文件交给 codex 独立审查，7 条发现的处置：

| # | codex 发现 | 采纳 |
|---|-----------|------|
| P1 | resume 路径没带自治标志/extraArgs | **采纳** → §2 bug 2，修 |
| P1 | 延后 query 迁移在 codex-only 下 summary 会失败 | **部分采纳**：经查 summary/dreaming 是 fire-and-forget + try/catch 只记日志（`execution-summary.ts:222-228`，dreaming「never throws」），**不阻断任务流**，属优雅降级。→ 决策 D3：MVP 接受降级，UI 明示「summary/dreaming/analysis 暂固定 Claude」，Phase B 迁移。 |
| P1 | hello probe 不保证关 stdin | **查证非 bug**（probe 走 `stdio:ignore`）→ §2 记录 5，不改 |
| P2 | 优先 `-a never --sandbox workspace-write` 而非全 bypass | **不采纳（决策 D1）**，理由见下，但**标注给用户裁决** |
| P2 | prompt 前加 `--`、防 `-a/-s` 冲突 | **不采纳（YAGNI）**：Claude adapter 不用 `--` 且稳定运行多版本；Tower 终端 extraArgs 不含 `-a/-s`，任务标题不以 `-` 开头。未验证的 `--` 反而可能破坏交互模式。记录为「考虑过，延后」 |
| P2 | 模型列表置空 | **采纳（决策 D2）** |
| P3 | 更新 "Codex 1.x" 过时注释 | **采纳** → §2 bug 4 |

**决策 D1 — 终端权限用 `--dangerously-bypass-approvals-and-sandbox`（全 bypass），不用 `-a never --sandbox workspace-write`。**
- 理由：Tower 终端的既定契约 = Claude 的 `--dangerously-skip-permissions`（全 YOLO）。codex 的 `workspace-write` 沙箱默认**禁网络**，会直接掐断 dev agent 的 `pnpm install` / 起 dev server / 访问 workspace 外路径等常规操作，导致 codex 终端体验**劣于** Claude 终端。全 bypass 才能行为对齐、无摩擦。
- 但这是**安全取舍**，codex 的顾虑成立（bypass 完全关沙箱=agent 有主机全权）。**实现里用单一常量 + `ponytail:` 注释标注更安全的替代**，改用 `-a never -s workspace-write` 只需一行。**留给用户明早裁决**（§7 待决项）。

**决策 D2 — codex `models.cli = []`（空）。** 账号默认最稳，避免硬编码模型名随 codex 版本/账号漂移导致的误报。UI 模型下拉对 codex 显示「账号默认」。

**决策 D3 — query 插槽（summary/dreaming/analysis）MVP 保持 Claude，明示不迁移。** 前两者 fire-and-forget 降级安全；analysis 是项目导入时 awaited 的独立流程，不由「跑 codex 任务」触发，MVP 不涉及。UI 插槽面板对这 4 个插槽灰显 + 注明，避免用户误以为已生效。

## 3. 方案：MVP = Codex 终端端到端可用

### 3.1 范围取舍（YAGNI）

**做（Phase A / 本次）：** 让 terminal 插槽能选 Codex 并跑通。理由：terminal 已接线抽象层，改动面最小、回归风险最低、用户价值最直接（用户「有 codex 了」的核心诉求就是拿它当终端跑任务）。

**不做（Phase B / 延后）：** query 插槽（summary/dreaming/analysis/assistant）迁移到 `resolveQueryAdapter`。理由：
- 触及核心 Claude 流程（每次任务停止/完成/导入都跑），盲改回归风险高；
- assistant 需流式，codex 的 `exec --json` 是 JSONL 批式，SSE 适配另需设计；
- 更适合用户在场时逐个实测。本文档 §5 留设计钩子，不实现。

### 3.2 Phase A 改动清单

**改动 1：修 Codex 适配器（§2 的 bug 1/2/3/4）**
- `buildSpawnArgs` 重构成 Claude adapter 同构：先无条件 `args.push("--dangerously-bypass-approvals-and-sandbox")` + `extraArgs`，**再**进 `resumeSessionId` / `continueLatest` / fresh 分支。
  - fresh：`--full-auto` 删除（bug 1）；prompt 作位置参数追加。
  - resume：`resume <id>` / `resume --last`，**不追加 prompt**（bug 2，与 Claude 一致）。
- `CODEX_MODELS`（:15）与 `providers/codex.ts:15` `models.cli`：**置空 `[]`**（决策 D2）；`getModels()` 返回 `[]`。
- 更正 adapter 里 "Codex CLI 1.x" 注释为 0.142.x（bug 4）。
- 更新单测 `__tests__/codex-cli-adapter.test.ts` 的 spawn 断言（fresh + resume 两条）。

**改动 2：能力插槽 Settings UI（新面板）**
- 新组件 `src/components/settings/capability-slots-panel.tsx`：
  - 读 `getAiCapabilityConfigs()` + `getConnectedProviders()`；
  - **MVP 先只渲染 `terminal` 一行**（其余 4 插槽灰显「即将支持」，避免用户选了无效果——因为消费点还没接线）；
  - provider 下拉只列 connected provider（未 connected 灰显 + hover「先 Test Connection」）；
  - 选中即调 `updateAiCapabilityConfig("terminal", { provider, mode:"cli", model })`（model 下拉来自 `providerDef.models.cli`，可留空=默认）。
- 挂到 `settings-page.tsx` 的「AI Tools」区末尾（同区，不新增顶级 section，最省）。
- i18n：`settings.capabilitySlots.*` zh/en 双语。

**改动 3：无 schema/DB 变更** — `AiCapabilityConfig` 已存在，`updateAiCapabilityConfig` 的连接门控已就绪。

### 3.3 用户操作闭环（Phase A 完成后）

1. Settings → AI Tools → Codex → **Test Connection**（跑 hello probe + 装 MCP/hooks/skill，写 `ProviderConnection`）。
2. Settings → AI Tools → 能力插槽 → terminal → 选 **Codex CLI**。
3. 任意任务 → 启动终端 → `resolveCliAdapter("terminal")` 解析到 codex → PTY 跑 `codex --dangerously-bypass-approvals-and-sandbox "<prompt>"` → 终端里就是 Codex。
4. Stop → codex stop hook 回推 Tower（sessionId/摘要触发路径不变）。

### 3.4 风险与回滚

- **回归风险**：改动只碰 codex adapter + 新增 UI 组件，**不改 Claude 路径**。terminal 插槽默认 provider 仍是 claude（resolver 无配置时优先 claude），老用户零感知。
- **回滚**：删插槽 UI + 还原 adapter 两行即可。
- **门控兜底**：若 codex Test Connection 未通过，`updateAiCapabilityConfig` 直接 throw，UI 也灰显，用户无法误选到跑不通的 provider。

---

## 4. 测试计划

- **单测**：`codex-cli-adapter.test.ts` 更新 spawn 断言（bypass flag）；`capability-resolver.test.ts` 已覆盖门控，不动。
- **typecheck**：`pnpm tsc --noEmit`（或项目脚本）。
- **端到端手测**（dev，`~/.tower-dev`）：
  1. Test Connection codex → 期望 ok + install 三项绿；
  2. 插槽设 codex → DB `AiCapabilityConfig` terminal 行 provider=codex；
  3. 起任务终端 → 实际是 codex 交互界面，能对话、能改文件；
  4. Stop → 任务转 IN_REVIEW，摘要流程不报错。
- 结果记录进本文档 §6（供用户明早查看）。

---

## 5. Phase B 设计钩子（延后，不实现）

- **query 插槽迁移**：`claude-session.ts:aiQuery` 抽成走 `resolveQueryAdapter(slot)`；新增通用 `CliQueryAdapter`（claude `-p --output-format json` / codex `exec --json`），各写 `parseResponse()`。一改覆盖 summary+dreaming+analysis（共用 aiQuery）。
- **assistant 多 provider**：`AssistantAdapter` 接口 + `ClaudeAssistantAdapter`（现 SDK query）/ `CodexAssistantAdapter`（`exec --json` JSONL → SSE 转换）。模型默认值不写死 sonnet，跟随 provider（见 `.notes/todo-assistant-multi-provider.md`）。
- **模型下拉动态化**：从 `~/.codex/models_cache.json` 或 `codex` 读实时模型，替代硬编码。

---

## 6. 端到端验证记录（2026-07-02）

**已验证（绿）：**
1. **单测** — `codex-cli-adapter.test.ts` 25/25 通过（fresh + resume 两条 spawn 断言按新行为更新）。
2. **typecheck** — 全量 `tsc --noEmit`：我改的 5 个文件零错误；仅 14 条 pre-existing 测试文件类型错（Prisma mock cast，与本次无关）。
3. **真实 CLI（codex-cli 0.142.5，本机）** — `--dangerously-bypass-approvals-and-sandbox` 在 fresh 与 `resume` 位置均解析通过；`codex exec "hi"`（关 stdin）秒回、且 Tower hooks 实际触发（`hook: SessionStart/Stop Completed`）；`tower` MCP 已注册。
4. **resolve→spawn 全链路（tsx 脚本 + dev DB）** — seed「codex 已连接」+ 设 terminal 插槽=codex，跑真实 `resolveCliAdapter("terminal")`：
   - 插槽空 → `provider=claude`，`claude --dangerously-skip-permissions <prompt>`（默认不变，老用户零感知）✓
   - 插槽=codex → `provider=codex`，fresh=`codex --dangerously-bypass-approvals-and-sandbox <prompt>`，resume=`codex --dangerously-bypass-approvals-and-sandbox --model gpt-5.5 resume <id>`（extraArgs 在 resume 子命令前，bug 2 修复生效）✓ **PASS**

**未验证（受阻，非本次改动引入）：**
- **浏览器级实测（Test Connection 按钮 → 插槽 UI → 真起 PTY 任务）** — dev server 编译失败：`@xterm/xterm/css/xterm.css` webpack CSS loader 解析报错（`Module parse failed (38:0) .xterm {`，trace：`layout-client → terminal-portal → task-terminal → xterm.css`），导致所有路由含 API 全 500。**与本次改动无关**（未碰 xterm/终端/CSS），在 main 上同样会崩，属独立的 dev 构建问题，建议单独排查。
- 为补偿：已在 **dev DB seed** 好 codex 连接 + terminal→codex，明早 dev 起来（构建问题解决后）即可在 Settings 直接看到 codex 已选中、并起任务实测。

**结论**：后端链路（adapter 修复 + resolver 选路 + 插槽落库）端到端 PASS；仅浏览器 UI 冒烟因 pre-existing 构建问题待补。

---

## 7. 待用户裁决（明早）

1. **终端权限强度（决策 D1）** — 当前实现用全 bypass（`--dangerously-bypass-approvals-and-sandbox`），对齐 Claude 的全 YOLO，无摩擦但 agent 有主机全权。codex 审查建议更保守的 `-a never -s workspace-write`（保留沙箱，但默认禁网络可能掐断 pnpm install / dev server）。代码里已用常量 + 注释标好切换点，改一行即可。**倾向保持全 bypass（与 Claude 一致），请确认。**
2. **Phase B 是否排期** — query 插槽迁移（summary/dreaming/analysis/assistant 走 `resolveQueryAdapter`）+ assistant 多 provider。建议你在场时逐个实测再做。
