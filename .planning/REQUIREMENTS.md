# Requirements: ai-manager v0.9

**Defined:** 2026-04-10
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.

## v0.9 Requirements

Requirements for milestone v0.9: 架构清理 + 外部调度闭环.

### 架构清理 (CLEAN)

- [x] **CLEAN-01**: Adapter dead code removed — `execute.ts`, `parse.ts`, `process-utils.ts`, `registry.ts`, `types.ts` deleted
- [x] **CLEAN-02**: CLI verification module (`test.ts`) relocated to `src/lib/cli-test.ts` with `/api/adapters/test` route updated
- [x] **CLEAN-03**: Preview process manager relocated to `src/lib/preview-process.ts`
- [x] **CLEAN-04**: 废弃路由 `/api/tasks/[taskId]/execute` 删除
- [x] **CLEAN-05**: `tsc --noEmit` 通过，无新增类型错误

### CLI Profile (CLIP)

- [x] **CLIP-01**: CLI Profile 配置对象定义（command、buildArgs、envVars）
- [x] **CLIP-02**: `startPtyExecution` 通过 profile 构建命令和参数（替代硬编码 "claude"）
- [x] **CLIP-03**: `resumePtyExecution` 通过 profile 构建命令和参数
- [ ] **CLIP-04**: Settings 页面 CLI Profile 查看/编辑

### 外部调度通知 (NTFY)

- [x] **NTFY-01**: `createSession` 支持 envOverrides 参数，传递到 PTY 子进程
- [x] **NTFY-02**: `startPtyExecution` 接受 callbackUrl 参数，注入 `AI_MANAGER_TASK_ID` + `CALLBACK_URL` 环境变量
- [x] **NTFY-03**: `notify-agi.sh` 开头检查 `AI_MANAGER_TASK_ID`，无则静默退出
- [x] **NTFY-04**: `~/.claude/settings.json` Stop hook 挂回 notify-agi.sh
- [x] **NTFY-05**: 飞书通知模板优化 — 包含任务标题、状态、耗时、摘要
- [x] **NTFY-06**: PTY idle 检测 — `lastActivityAt` + 可配置阈值（≥180s），触发 onIdle 回调
- [x] **NTFY-07**: idle 检测响应用户输入 resetIdleTimer

### MCP 终端交互 (TERM)

- [x] **TERM-01**: Internal HTTP route `GET /api/internal/terminal/[taskId]/buffer` — 返回 PTY 缓冲区最近 N 行
- [x] **TERM-02**: Internal HTTP route `POST /api/internal/terminal/[taskId]/input` — 往 PTY 发送文本
- [x] **TERM-03**: MCP 工具 `get_task_terminal_output` — 通过 HTTP bridge 读取终端输出
- [x] **TERM-04**: MCP 工具 `send_task_terminal_input` — 通过 HTTP bridge 发送指令
- [x] **TERM-05**: MCP 工具 `get_task_execution_status` — 返回任务执行状态（running/idle/exited + 最后输出摘要）

### 数据模型 (DATA)

- [x] **DATA-01**: TaskExecution 增加 `callbackUrl` 可选字段
- [x] **DATA-02**: Prisma migration 生成并应用

## Future Requirements

### 多 CLI 深度集成

- **MCLI-01**: Prisma `CliProfile` 数据模型（支持多个 CLI 配置持久化）
- **MCLI-02**: CLI Profile 切换 UI（任务执行时选择使用哪个 CLI）

## Out of Scope

| Feature | Reason |
|---------|--------|
| Adapter 接口重建 | 当前只有一个 CLI，不需要抽象层 |
| MCP 工具实时推送（SSE/WebSocket） | 轮询 HTTP bridge 足够，实时推送复杂度高 |
| 多飞书群通知路由 | 固定默认群 ID，后续按需扩展 |
| Settings 通知模板编辑 UI | 模板在 notify-agi.sh 里改，不需要 UI |
| 认证系统 | localhost-only 个人工具 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLEAN-01 | Phase 29 | Complete |
| CLEAN-02 | Phase 29 | Complete |
| CLEAN-03 | Phase 29 | Complete |
| CLEAN-04 | Phase 29 | Complete |
| CLEAN-05 | Phase 29 | Complete |
| DATA-01 | Phase 30 | Complete |
| DATA-02 | Phase 30 | Complete |
| CLIP-01 | Phase 30 | Complete |
| CLIP-02 | Phase 31 | Complete |
| CLIP-03 | Phase 31 | Complete |
| NTFY-01 | Phase 31 | Complete |
| NTFY-02 | Phase 31 | Complete |
| NTFY-06 | Phase 31 | Complete |
| NTFY-07 | Phase 31 | Complete |
| NTFY-03 | Phase 32 | Complete |
| NTFY-04 | Phase 32 | Complete |
| NTFY-05 | Phase 32 | Complete |
| TERM-01 | Phase 33 | Complete |
| TERM-02 | Phase 33 | Complete |
| TERM-03 | Phase 34 | Complete |
| TERM-04 | Phase 34 | Complete |
| TERM-05 | Phase 34 | Complete |
| CLIP-04 | Phase 35 | Pending |

**Coverage:**
- v0.9 requirements: 19 total
- Mapped to phases: 19 (100%)
- Unmapped: 0

---
*Requirements defined: 2026-04-10*
*Last updated: 2026-04-10 — traceability added after roadmap creation*
