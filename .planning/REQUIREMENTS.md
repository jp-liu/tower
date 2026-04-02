# Requirements: ai-manager

**Defined:** 2026-04-02
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## v0.7 Requirements

Requirements for v0.7 — 终端交互体验. Each maps to roadmap phases.

### 终端后端

- [x] **PTY-01**: 系统可通过 node-pty 为每个任务创建 PTY 伪终端会话
- [x] **PTY-02**: PTY 会话注册表管理会话生命周期（创建/查询/销毁）
- [x] **PTY-03**: PTY 进程退出或任务完成时自动清理（防止僵尸进程）

### WebSocket 通信

- [x] **WS-01**: `instrumentation.ts` 启动独立 WebSocket server (port 3001)
- [x] **WS-02**: WebSocket 双向转发 xterm.js ↔ PTY 输入输出
- [x] **WS-03**: WebSocket 连接断开时 PTY 保活（不立即销毁，等待重连）
- [x] **WS-04**: WebSocket Origin 校验防止 CSWSH 攻击

### 终端前端

- [x] **TERM-01**: xterm.js 终端组件替换任务页左侧聊天气泡界面
- [x] **TERM-02**: 终端支持键盘输入（交互式 Claude CLI 操作）
- [x] **TERM-03**: 终端 resize 与浏览器窗口同步（FitAddon + PTY resize）
- [x] **TERM-04**: 终端主题跟随应用 dark/light 设置

### 会话集成

- [ ] **INT-01**: 点击"执行"时创建 PTY 会话并在终端组件显示
- [ ] **INT-02**: Claude CLI 在 PTY 中运行（不用 stream-json，保留原始 TTY 输出）
- [ ] **INT-03**: PTY 退出后更新任务状态（成功→IN_REVIEW，失败→保持）

### 任务交互增强

- [ ] **TASK-01**: 任务 Kanban 卡片支持右键菜单（更改状态、启动任务、前往详情页）
- [ ] **TASK-02**: 右键"启动任务"直接运行 Claude CLI（仅未执行过的任务可点击，已执行过的置灰）
- [ ] **TASK-03**: 右键"前往详情页"跳转到任务工作台页面

### Bug 修复

- [ ] **FIX-01**: v0.6 编辑器加载不稳定修复
- [ ] **FIX-02**: v0.6 Diff 显示条件修复（NORMAL 类型项目也支持）

## Future Requirements

Deferred to future release.

### 终端进阶

- **TERM-F01**: 终端会话重连（浏览器刷新后恢复终端状态）
- **TERM-F02**: 终端输出序列化存储（@xterm/addon-serialize）
- **TERM-F03**: 多终端标签页支持
- **TERM-F04**: 终端历史记录回放

### 交互进阶

- **TASK-F01**: 任务批量操作（多选 + 批量状态变更）
- **TASK-F02**: 任务拖拽到不同项目

## Out of Scope

| Feature | Reason |
|---------|--------|
| WebContainer 浏览器内运行 | localhost 已有 Node.js，node-pty 更直接 |
| SSH 远程终端 | 本地工具，不需要远程连接 |
| 终端录制/回放 | 复杂度高，延迟到 v0.8+ |
| 多用户终端共享 | 本地单用户工具 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PTY-01 | Phase 24 | Complete |
| PTY-02 | Phase 24 | Complete |
| PTY-03 | Phase 24 | Complete |
| WS-01 | Phase 24 | Complete |
| WS-02 | Phase 24 | Complete |
| WS-03 | Phase 24 | Complete |
| WS-04 | Phase 24 | Complete |
| TERM-01 | Phase 25 | Complete |
| TERM-02 | Phase 25 | Complete |
| TERM-03 | Phase 25 | Complete |
| TERM-04 | Phase 25 | Complete |
| INT-01 | Phase 26 | Pending |
| INT-02 | Phase 26 | Pending |
| INT-03 | Phase 26 | Pending |
| TASK-01 | Phase 27 | Pending |
| TASK-02 | Phase 27 | Pending |
| TASK-03 | Phase 27 | Pending |
| FIX-01 | Phase 28 | Pending |
| FIX-02 | Phase 28 | Pending |

**v0.7 Coverage:**
- v0.7 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-02*
*Last updated: 2026-04-02 — traceability updated after v0.7 roadmap creation*
