# Process & Resource Lifecycle

## PTY Sessions

- Sessions keyed by `taskId` — one active session per task.
- Concurrency limited by `system.maxConcurrentExecutions` config (default 20).
- Disconnect keepalive: 2h (running) / 5min (exited), then auto-destroy.
- SIGTERM handler in `session-store.ts` kills all sessions on exit.

## Preview Processes

- Auto-stop on component unmount (page navigation).
- Auto-remove from registry on process exit.
- SIGTERM/SIGINT handlers kill all preview processes on app exit.
- No `child.unref()` — parent must track child lifecycle.

## WebSocket Server

- Flush batched sender on WebSocket close.
- Clear polling timer on WebSocket error.
- Port read from `terminal.wsPort` config (default 3001).

## Timers

- All `setTimeout`/`setInterval` must be cleared in cleanup (useEffect return, onClose, onExit).
- Resize debounce timers must be cleared on component unmount.

## Database

- Prisma `$disconnect()` called on SIGTERM/SIGINT.
- SQLite WAL mode + busy_timeout=5000 set in `initDb()`.

## Preview PTY Sessions

- Sessions keyed by `(cwd, command, port)` 三元组 — see `src/lib/preview/preview-key.ts`.
- 复用 `PtySession` 类，**不**使用 `pty/session-store.ts`（独立 store 在 `src/lib/preview/session-store.ts`）。
- 长 lived — 用户关闭 task 详情页 PTY 不杀，再次打开继续看；只有显式 Stop 或 SIGTERM 才终止。
- `onIdle: undefined` — dev server 长时间静默是正常状态，不能被 idle timer 误杀。
- 创建后立即 `pty.resize(200, 50)` — 避免 dev server 因 80 列窄宽换行打断 readyRegex 匹配。
- SIGTERM / SIGINT / SIGHUP 钩子注册时用 `globalThis.__previewSignalHandlersRegistered` flag 防重复。
- `sessions` Map 挂在 `globalThis.__previewSessions` 上，HMR-safe。

## Hook Scripts

- Tower 的 Claude Code hook 脚本（`scripts/`）命名统一加 `tower-` 前缀：`tower-stop-hook.js` / `tower-session-start-hook.js` / `tower-pre-tool-hook.js` / `tower-post-tool-hook.js`。新增 hook 一律 `tower-<event>-hook`。
- `tower-pre-tool-hook.js` 是 **PreToolUse 硬禁**：matcher 精确到 `AskUserQuestion`（Claude/Codex 同名），仅在「无父任务 + 有人值守」放行，否则返回 `permissionDecision:"deny"` 逼走升级阶梯。状态从 spawn 时注入的 env 读：`TOWER_HAS_PARENT`（静态）+ `TOWER_SIGNAL_DIR`（信号目录，因 PTY 剥了 `TOWER_DATA_DIR` 只能注入解析好的路径）；无人值守信号文件 `unattended-<taskId>` 由 `set_goal_mode` / 状态流转经 `src/lib/harness/unattended-signal.ts` 写删。Codex 侧 spawn 需 `--dangerously-bypass-hook-trust`，且 `[features]` 特性名已从 `codex_hooks` 迁到 `hooks`。
- 注册/卸载在 `src/lib/ai/adapters/cli/claude-cli-adapter.ts`（`installHooks` / `repairHookPaths`）—— 改名脚本要**同步**这里的路径与 filename marker（marker 用 `includes` 匹配做 clean uninstall；注意老用户 `~/.claude/settings.json` 里的旧路径）。
- 一个 hook 事件 = 一个脚本 = 一次 POST；后端 **fan-out** 给多个消费者，不为新增消费者拆 hook/route。例：Stop hook → `POST /api/internal/hooks/stop` → `broadcastNotification`（浏览器通知）+ `notify-parent`（父任务回推），二者各自容错、互不拖累。
