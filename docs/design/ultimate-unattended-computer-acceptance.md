# 终极无人值守电脑验收方案

> 2026-08-05 行为变更：无人值守只按时间生效，默认 8 小时；次数、回合、子任务和 Job 上限不再参与停止或阻断。
> 下方“当前预验收记录”保留的是旧版本历史证据，涉及 `maxUses` 或多重预算的结论已被本变更取代，需按新版 B/F Gate 重验。

> 状态：验收完成；Gate A-F、飞书 GPT-5.5 手机主入口、全量回归、Claude 独立复核与环境清理均已通过
> 基线分支：`codex/ultimate-unattended-runtime`
> 基线提交：`643934d`
> 更新日期：2026-08-03
> 上位章程：[`ultimate-unattended-computer-charter.md`](./ultimate-unattended-computer-charter.md)
> Technical Spec：[`ultimate-unattended-computer-technical-spec.md`](./ultimate-unattended-computer-technical-spec.md)
> 架构图解：[`ultimate-unattended-computer-architecture.md`](./ultimate-unattended-computer-architecture.md)

## 1. 验收目标与结论规则

本验收证明的不是“页面上出现了无人值守按钮”，而是以下纵向闭环在真实运行时中成立：

```text
Tower UI 限域授权
  -> Capability discovery / schema
  -> Direct 或 OpenClaw Job 单路执行
  -> 权威结果与证据
  -> Workbench 持久唤醒
  -> Goal 预算、恢复、阻塞或完成
```

验收采用三层结论：

| 结论 | 含义 |
|---|---|
| `PASS` | 操作结果、数据库权威状态和外部可观察结果全部一致，证据完整 |
| `BLOCKED` | 代码未证明错误，但缺少真实 OpenClaw、Operator、渠道或稳定环境，不能宣称通过 |
| `FAIL` | 任一安全不变量被破坏，或 UI、数据库、回调、外部副作用之间出现矛盾 |

以下情况一律不能降级为“偶现”后放行：

- UI 显示已授权，但 `CapabilityGrant` 或 `UnattendedGoalRuntime` 不存在；
- 外部动作已经发生，但 Tower 记录为可自动重试的普通失败；
- 相同 `requestId` 导致两次外部副作用；
- Goal 已 `ENDED`，旧 grant 仍能创建新的 R2/R3 请求；
- callback 丢失或进程重启后，请求永久悬空且只读对账无法恢复；
- Tower 暴露 OWNER destination、OpenClaw Operator `agentId` 或平台凭据；
- 没有有效限域授权时，模型从 Goal 文本或任务描述推断出 R2/R3 权限。

## 2. 范围与非范围

### 2.1 本轮必须验收

1. Tower 模块边界、迁移、发布包和 MCP 工具面；
2. Tower UI 对 unattended Goal 的启用、撤销和 fail-closed 行为；
3. `CapabilityRequest` schema、grant、去重、结果归一化和只读恢复；
4. OpenClaw capability plugin 的 discovery、Operator Job 和 completion callback；
5. Workbench 持久唤醒、Goal timer、预算、watchdog 和 provider-confirmed completion；
6. Tower / OpenClaw 重启、丢回调、乱序、超时和未知副作用故障注入；
7. Computer Use 黑盒 UI 验收与数据库白盒断言互相印证。

### 2.2 本轮不要求

- 不拆 npm 包、进程或数据库；
- 不为验收创建第二套 Registry、Job 系统或 Event Bus；
- 不要求公开 npm 包自带 Computer Operator；
- 不要求一次适配所有 SaaS、渠道和桌面应用；
- 不用生产 OWNER 群、生产数据或不可撤销外部动作做首次验证；
- 网络不稳定时不反复重发真实渠道消息来“碰运气”。

## 3. 验收角色与证据

Codex 与 Claude 使用同一提交、同一验收编号和同一数据库断言。建议一方执行、另一方独立复核证据后交换角色，不能只互相阅读结论。

每个用例至少保留：

- 分支、完整 commit SHA、Node/pnpm/Tower/OpenClaw 版本；
- 执行命令和退出码；
- Computer Use 截图或可访问性树中的关键文案；
- 脱敏后的相关数据库行；
- OpenClaw task/run 状态、revision 和时间戳；
- 外部平台回执或 Operator 证据；
- 结论、执行人、时间和异常说明。

禁止在证据中保存 bearer token、渠道凭据、OWNER destination、完整私聊内容或 OpenClaw `agentId` 映射。

## 4. 环境隔离

### 4.1 硬约束

- 默认使用 Node `os.tmpdir()` 对应的系统临时目录下新建的 `tower-e2e-*` 数据目录；
- 不修改 `~/.tower/database/tower.db`；
- 不把 `~/.tower-dev` 当作可随意清理的验收库；
- 同一数据库同一时间只允许一个 Tower runtime；
- 先检查端口和进程，不能复用来源不明的 9022/9023 进程；
- 首次 Direct / Job 外部验收只使用专用测试目标和可逆、低风险动作。

### 4.2 建立隔离数据库

```bash
TOWER_ACCEPT_TMP_ROOT="${TMPDIR:-/tmp}"
TOWER_ACCEPT_DATA_DIR="$(mktemp -d "${TOWER_ACCEPT_TMP_ROOT%/}/tower-e2e-unattended-XXXXXX")"
export TOWER_ACCEPT_DATA_DIR
TOWER_ACCEPT_DATABASE_URL="file:${TOWER_ACCEPT_DATA_DIR}/database/tower.db"
export TOWER_ACCEPT_DATABASE_URL
TOWER_DATA_DIR="$TOWER_ACCEPT_DATA_DIR" \
DATABASE_URL="$TOWER_ACCEPT_DATABASE_URL" \
node scripts/prepare-e2e-db.mjs
```

`prepare-e2e-db.mjs` 会删除并重建目标目录，因此目标必须同时满足：位于系统临时目录、basename 以
`tower-e2e-` 开头。不得把变量替换为工作区、用户目录或生产数据目录。

### 4.3 启动验收服务

优先使用 production build，避免 dev HMR、重复 instrumentation 和生成类型文件干扰状态判断：

```bash
pnpm build
TOWER_DATA_DIR="$TOWER_ACCEPT_DATA_DIR" \
DATABASE_URL="$TOWER_ACCEPT_DATABASE_URL" \
PORT=9122 \
node bin/tower.mjs --host 127.0.0.1 --port 9122 --no-open
```

启动后必须记录 `TowerRuntimeLease`，并确认没有第二个 runtime 获得同一数据库：

```bash
sqlite3 "$TOWER_ACCEPT_DATA_DIR/database/tower.db" \
  'SELECT id, ownerId, pid, port, generation, expiresAt FROM TowerRuntimeLease;'
```

## 5. Gate A：代码、迁移和发布包

| ID | 验收项 | 执行方式 | 通过条件 |
|---|---|---|---|
| A01 | 基线与工作树 | `git status --short`、`git rev-parse HEAD` | SHA 与记录一致；无非验收改动 |
| A02 | Prisma 与类型 | `pnpm exec prisma generate && pnpm exec tsc --noEmit` | 退出码 0 |
| A03 | 代码规范 | `pnpm lint` | 退出码 0；无新增 warning |
| A04 | 全量单测 | `pnpm exec vitest run` | 全量通过；skip/todo 数量有记录且无意外增加 |
| A05 | MCP bundle | `pnpm mcp:build` | bundle 成功，capability tools 在预期 profile 中 |
| A06 | Production build | `pnpm build` | standalone 构建成功 |
| A07 | 发布包 canary | `pnpm release:smoke` | 临时安装、迁移、启动和 package content 全部通过 |
| A08 | 迁移幂等 | 对新库连续执行两次 `pnpm exec tsx scripts/run-migrations.ts`，每次都显式传入验收数据目录和数据库 URL | 0029-0034 仅各记录一次，第二次无破坏 |
| A09 | 安装内容 | 检查打包清单 | 0029-0034、`tower` / `tower-bridge` / `tower-goal` 和 OpenClaw plugin 均存在；旧 `tower-ask` 已合并并由升级清理移除 |
| A10 | 图文一致 | 核对章程、Spec、架构图和代码目录 | 不把逻辑 Capability 边界描述成新服务；状态所有权一致 |

建议至少单独记录以下关键测试文件的结果，便于故障定位：

```bash
pnpm exec vitest run \
  src/lib/gateway/__tests__/capability-contract.test.ts \
  src/lib/gateway/__tests__/capability-runtime.test.ts \
  src/lib/gateway/__tests__/capability-migration.test.ts \
  src/lib/gateway/__tests__/openclaw-task-client.test.ts \
  src/lib/unattended-goal/__tests__/runtime.test.ts \
  src/lib/unattended-goal/__tests__/policy.test.ts \
  src/lib/unattended-goal/__tests__/migration.test.ts \
  src/lib/workbench/__tests__/coordinator.test.ts \
  src/app/api/internal/harness/capabilities/completions/__tests__/route.test.ts
```

## 6. Gate B：Tower 本地 UI 与数据库闭环

本 Gate 不发送任何外部消息，网络断开也应可以完成。Computer Use 负责像用户一样操作 Tower 页面；
SQLite 查询负责证明 UI 后面的权威状态真实存在。

### B01：没有 OWNER home route 时必须拒绝

前置条件：隔离库不存在 active unattended OWNER route。

1. 用 Computer Use 打开一个任务详情页；
2. 点击“启用无人值守”，保留默认 8 小时；
3. 确认启用；
4. 记录错误提示和服务端响应；
5. 查询数据库。

```sql
SELECT taskId, state, lastEventKind
FROM UnattendedGoalRuntime
WHERE taskId = '<taskId>';

SELECT id, capability, expiresAt, revokedAt
FROM CapabilityGrant
WHERE taskId = '<taskId>';
```

通过条件：UI 明确提示需要固定 OWNER route；两条查询均无新增行；`Task.unattended = 0`。

### B02：启用必须原子持久化 runtime 与 grant

先停止验收服务，再只在隔离库写入一个假的固定 OWNER route。该 route 仅用于 discovery 与授权界面，
**不得提交 Direct 请求**：

```sql
INSERT INTO SystemConfig (id, key, value, createdAt, updatedAt)
VALUES (
  'acceptance-harness-targets',
  'harness.targets',
  '[{"id":"acceptance-owner","label":"Acceptance OWNER","gateway":"hermes","downstream":"feishu","dest":"acceptance-dry-run","active":true,"scope":"unattended"}]',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updatedAt = CURRENT_TIMESTAMP;
```

重启验收服务后，用 Computer Use 再次启用。页面必须显示“无人值守已授权”，并立即执行：

```sql
SELECT taskId, state, lastEventKind, maxDurationMs, activatedAt, endedAt
FROM UnattendedGoalRuntime
WHERE taskId = '<taskId>';

SELECT id, capability, risk, targetKind, expiresAt, revokedAt
FROM CapabilityGrant
WHERE taskId = '<taskId>'
ORDER BY createdAt DESC;

SELECT id, unattended
FROM Task
WHERE id = '<taskId>';
```

通过条件：

- 恰有一个 `ACTIVE / ACTIVATED` runtime；
- `human.message.send / R2 / OWNER_HOME_ROUTE` grant 存在、未撤销、未过期；
- UI 和 capability discovery 只显示截止时间，不显示或要求次数；
- `Task.unattended = 1` 仅作为兼容影子；
- 刷新页面后仍显示已授权；
- 服务心跳继续更新，日志无 `SQL error or missing database`。

任何“UI 成功但上述行不存在”的结果直接判 `FAIL`。

### B03：撤销必须结束 runtime 并撤销 grant

用 Computer Use 点击“停用无人值守”后重复 B02 查询。

通过条件：runtime 为 `ENDED / DEACTIVATED`，`Task.unattended = 0`，全部活动 grant 的 `revokedAt` 非空；
刷新后页面保持未授权。重复停用不报错、不创建额外 runtime 或 grant。

### B04：界面与可访问性

在任务详情页和侧边详情面板分别验证：

- loading、未授权、授权中、已授权、停用中、失败六种状态不会重复提交；
- 120 分钟、8 小时、24 小时与 5/20/50 次正确映射到持久策略；
- 不可用 Job capability 不可勾选；可用 R2/R3 capability 必须显式逐项勾选；
- 键盘可打开对话框、切换控件、取消和确认，焦点不丢失；
- 390x844、1280x720、1440x900 无遮挡、截断和横向溢出；
- UI 不显示 OWNER destination、凭据或 Operator `agentId`。

## 7. Gate C：Capability 契约与安全不变量

| ID | 场景 | 通过条件 |
|---|---|---|
| C01 | Discovery | 返回版本、lane、risk、availability、完整 input/output schema 或可解析 schema；不返回真实目标和 `agentId` |
| C02 | 无授权提交 R2/R3 | fail-closed；不创建外部动作 |
| C03 | 非 UI 自授权 | `set_goal_mode` 返回 `authorizationGranted: false`；Goal 文本不能产生 grant |
| C04 | 非法 schema | 在消费 grant 前拒绝；`usedCount` 不变 |
| C05 | 注入 destination/agent/command | envelope strict 校验拒绝 |
| C06 | `requestId` 重放 | 相同 payload 返回同一快照，不产生第二次副作用 |
| C07 | `requestId` 变更 payload | 明确拒绝，不覆盖原请求 |
| C08 | route revision 改变 | 已签 grant 失效；请求在 dispatch 前进入保守状态 |
| C09 | Goal `ENDED` | discovery 不再暴露旧授权，也不能创建新的 R2/R3 请求；只允许 runtime 已持久化且 request id/kind 完全匹配的最终 OWNER 通知完成投递 |
| C10 | Goal `BLOCKED` | 不接受新 Job；只保留限域 OWNER 通知路径 |
| C10a | 完成通知失败 | Goal 保持 `ENDED`；`ownerNotificationState/error` 独立显示并支持恢复，不伪装成任务阻塞 |
| C11 | `SIDE_EFFECT_UNKNOWN` | 终态；恢复扫描不自动重试、不 fallback 到第二条路径 |
| C12 | completion callback | 仅 localhost 固定 path + 正确 bearer token 可用；错误 token、非本机 URL 和错误 runId 被拒绝 |
| C13 | 乱序状态 | 迟到 `RUNNING` 不覆盖 `SUCCEEDED/FAILED/BLOCKED/CANCELLED/EXPIRED/SIDE_EFFECT_UNKNOWN` |
| C14 | 单路迁移 | 同一请求只走旧路径或 CapabilityRequest 路径之一，不双重执行 |

数据库辅助断言：

```sql
SELECT requestId, capability, lane, risk, state, revision,
       authorizationRef, gateway, jobRef, resultEventPublishedAt, updatedAt
FROM CapabilityRequest
WHERE taskId = '<taskId>'
ORDER BY updatedAt;
```

## 8. Gate D：OpenClaw / o-tower 集成

本 Gate 需要稳定的本机 OpenClaw，但仍不需要真实 GUI 副作用。

### D01：插件安装与配置归属

1. Tower Agent 安装器安装 `tower-capability-bridge`；
2. `openclaw plugins inspect tower-capability-bridge` 显示 loaded；
3. `openclaw plugins doctor` 无该插件错误；
4. 空 capability 配置合法；
5. 用户已有 `plugins.allow` 时只追加 Tower entry，卸载时只移除 Tower 管理内容；
6. Operator `agentId`、schema 和路由仅存在于 OpenClaw plugin config。

### D02：低风险测试 Job

配置一个专用测试 capability，例如 `computer.test.observe`，只允许读取一个测试页面或返回固定环境信息，
不点击、不发送、不写外部系统。Tower discovery 应取得 schema 和 route revision，但看不到 `agentId`。

提交后验证：

1. Tower 返回 `ACCEPTED + jobRef`；
2. OpenClaw 以 `tower-capability:<requestId>` 作为原生幂等 key；
3. `openclaw tasks show <jobRef> --json` 可读到权威状态；
4. completion hook 只回传 `requestId + runId`；
5. Tower 再做只读查询后持久化终态、revision、摘要和证据；
6. Workbench 只收到一次 `CAPABILITY_RESULT_AVAILABLE`。

### D03：o-tower 边界

- o-tower 可以与 Tower 使用同一种业务 capability 命名和 schema；
- 人类普通消息仍由 o-tower/渠道会话处理，不为发送消息先让 Tower 读取完整上下文；
- Tower sibling task handoff 不绕到 OpenClaw；
- 项目事实和审查结论仍回 Tower，OpenClaw 不复制第二套项目状态；
- `tower-bridge` 不硬编码 `xiao-fei`、`computer-operator`、workspace 路径或底层命令。

## 9. Gate E：恢复与故障注入

每个故障用新的 `requestId`，动作必须低风险、可观察。恢复期间禁止人工补写数据库来伪造成功。

| ID | 注入点 | 操作 | 通过条件 |
|---|---|---|---|
| E01 | Tower 在 Job accepted 后退出 | 停 Tower，保留 OpenClaw Job；再启动 | callback 或低频扫描恢复同一 `jobRef`，不新建 Job |
| E02 | OpenClaw 执行中退出 | 停 OpenClaw，再恢复其原生 task | Tower 不猜成功；恢复后只读对账同一 Job |
| E03 | completion callback 丢失 | 阻断一次 callback | 60 秒恢复扫描取得终态并只发布一次 Workbench 事件 |
| E04 | callback 先于 submit response | 使用立即完成的 fixture Job | Tower 用幂等 key 修复 `jobRef`，无需等待下一轮扫描 |
| E05 | 迟到 `RUNNING` | 终态后注入旧 revision | 终态不回退 |
| E06 | 不确定副作用 | Adapter 返回可能已执行但无可信回执 | 记录 `SIDE_EFFECT_UNKNOWN`，零自动重试 |
| E07 | Workbench 写入前退出 | 终态已持久化、published marker 未写时退出 | 重启后补一个事件，marker 与事件原子一致 |
| E08 | Goal timer 与结束竞态 | timer 到期同时结束 Goal | `ENDED` 后不发布迟到 timer |
| E09 | runtime leader 失租 | 第二 runtime 竞争或 leader 心跳失败 | 第二实例拿不到 lease；失租实例在分裂脑前退出 |
| E10 | 数据库暂时 busy | 短时持锁后释放 | 按 busy timeout 恢复；不丢 grant/request/runtime |

E01-E10 每项都要同时核对 `CapabilityRequest`、`WorkbenchEvent/Batch`、`UnattendedGoalRuntime` 和
`TowerRuntimeLease`，不能只看日志。

## 10. Gate F：Goal 长循环

### F01：正常无人值守闭环

使用一个只读 Operator Job 和一个 OWNER 测试消息完成：

1. OWNER 在 Tower UI 签发 2 小时的无人值守；
2. Goal 启动一轮 provider turn；
3. provider 进入持久 `WAITING`，而不是靠终端静默猜测；
4. 提交一个只读 Job；
5. Job 终态唤醒 Workbench；
6. 主责任方验收结果；
7. Goal 进入 `DONE/REVIEW`，停止 timer、撤销授权并发送一次去重完成通知。

通过条件：每次唤醒都能追溯到持久事件或 timer；没有空转；没有重复通知；Tower 只保存项目摘要和
`requestId/jobRef` 关联，不复制 OpenClaw 完整状态机。

### F02：时间截止与任务隔离

设置 5 分钟 duration，并在期间创建多个子任务、记录多个 provider turn、失败事实和 capability Job。

通过条件：截止前 runtime 始终为 `ACTIVE`，新任务均可创建且不继承父 runtime；消息授权可重复使用且 discovery
不返回剩余次数。到期后原子进入 `ENDED / DURATION_EXPIRED`、撤销授权且不发布 `GOAL_BLOCKED`。人工关闭则
立即进入 `ENDED / DEACTIVATED`。

### F03：OWNER ask/reply

发出 `expectReply=true` 的限域 OWNER 消息，确认发送成功后复用既有 ask/park 生命周期。OWNER 回复形成
持久唤醒事实；普通“现在什么状态”只返回上下文，不会隐式恢复已经结束的终端。

## 11. Computer Use 操作规范

Computer Use 是最终用户黑盒验收，不替代数据库和协议测试。

1. 通过本机 Safari 或 Chrome 打开明确的 `127.0.0.1` 验收 URL；
2. 每次点击前重新读取当前可访问性树，避免使用过期元素索引；
3. 只按用户可见控件操作，不通过脚本直接调用 React action 冒充 UI 验收；
4. 记录对话框文案、按钮 loading/disabled、toast、刷新后的持久状态；
5. 同一操作后立即查询隔离 SQLite，等待至少三个 runtime heartbeat 后再查一次；
6. 涉及真实外部动作时，先记录专用目标和唯一验收标记，再只提交一次；
7. 页面成功、服务 200、数据库落库、外部结果四者必须一致。

## 12. 当前预验收记录

截至 2026-08-03，本轮已有以下事实：

| 项目 | 当前结论 | 证据/说明 |
|---|---|---|
| PR 自动化 | `PASS` | 分支 `643934d` 的 PR CI 已通过 test 与 extension catalog；合并前仍需确认目标分支包含前置提交 |
| 自动测试与构建 | `PASS` | 最终候选工作树全量复跑：257 files pass、6 skip，2287 tests pass、27 todo，退出码 0；lint、独立 `tsc --noEmit`、production build、MCP bundle 与 `git diff --check` 均退出码 0。build 仅保留既有 Turbopack NFT 动态追踪 warning |
| 发布包 canary | `PASS` | Codex 修复 npm 11 全局 lifecycle 白名单和首次 SQLite 建库后，`pnpm release:smoke` 退出码 0；合并消息 skill 后临时安装检查 9 个内嵌 Runtime/Provider/skill 路径、全新建库、33 个迁移、fixture plugin、API、Summary、Assistant、Terminal plans 全部通过 |
| OpenClaw plugin load | `PASS` | OpenClaw `2026.7.1-2`：Tower 安装器完成重装，`plugins inspect` 为 loaded，doctor 无插件错误；验收后 capability fixture 已清空 |
| 真实本地开发库 B01 | `PASS` | Computer Use 确认无固定 OWNER route 时 UI 请求被后端拒绝；未新增 runtime/grant；未发送外部消息 |
| 隔离副本 B02/B03 | `PASS` | Computer Use 在隔离 production UI 以默认 8 小时/20 次启用：同一 SQLite 立即得到 `ACTIVE/ACTIVATED`、`human.message.send/R2/OWNER_HOME_ROUTE`、`usedCount=0/maxUses=20`、`Task.unattended=1`；刷新仍显示已授权。停用后为 `ENDED/DEACTIVATED`、grant `revokedAt` 非空、影子位为 0，刷新保持未授权 |
| B04 响应式与可访问性 | `PASS` | production 详情页在 390×844、1280×720、1440×900 均无水平溢出或交互控件越界；390px 下改为上下分栏，文件工具区改为上下布局。弹窗在 390/1280 视口内完整显示，120/480/1440 分钟与 5/20/50 次映射正确，R2 默认未勾选，未暴露 OWNER destination、凭证或 `agentId`；键盘可打开候选项，Esc 关闭后焦点返回入口。补充六状态组件回归后，production 黑盒关闭 OWNER route 并确认启用：弹窗保留 `role=alert` 失败信息且可重试，数据库保持 `Task.unattended=0 / grant=0 / runtime=0`；同步防重入保证同一事件轮双击仅提交一次 |
| C01-C14 | `PASS` | 自动化覆盖 grant、未知副作用、乱序、callback、事件去重、预算和 leader；E Gate 的真实进程级注入也已完成。Goal 结束或预算阻塞时现于同一事务撤销全部未过期 capability grant，旧授权不能继续创建 R2/R3 请求 |
| D01 | `PASS` | 安装器保留既有飞书 OWNER/群路由；discovery 只公开 capability/schema/route revision，不含 Operator `agentId` |
| D02 | `PASS` | 临时只读 R1 `computer.test.observe` discovery 不泄露 `agentId`；request `d02f0000-0000-4000-8000-202608030001` 返回 `ACCEPTED + jobRef`，OpenClaw 原生 task `succeeded`，Tower 对账为 `SUCCEEDED`，只写 1 条 `CAPABILITY_RESULT_AVAILABLE`；同 requestId 重放返回原快照且无第二次执行。验收后已恢复原 capability 配置 |
| 飞书 DIRECT | `PASS` | 隔离库使用唯一验收标记，`human.message.send` 最终为 SUCCEEDED，HarnessOutbound 为 DELIVERED 且有平台 message id；未要求人工回复 |
| 飞书 GPT-5.5 计算器 | `PASS` | 原 GUI 标记 `TOWER-ACCEPT-GPT55-FEISHU-CALC-20260803-C` 的 `openai/gpt-5.5`、`preflight=gui`、`basic-decimal`、可见 `42×8 / 336` 有效；补充 `im:resource` 后用 `TOWER-ACCEPT-FEISHU-IMAGE-20260803` 重发，平台回执 `kind=media`，飞书会话显示 `[Image]` |
| 飞书 GPT-5.5 浏览器 | `PASS` | 原 GUI 标记的真实 URL、标题、`Install` 有效；补充权限后用 `TOWER-ACCEPT-FEISHU-BROWSER-IMAGE-20260803` 重发，平台回执 `kind=media` |
| 飞书小塔卡片 | `PASS` | `TOWER-ACCEPT-FEISHU-NATIVE-MEDIA-20260803` 取得真实平台 message id，回执 `parts.kind=card`；Computer Use 确认可见“✅ 小塔 · 手机端交付验收” |
| 飞书原生图片 | `PASS` | 首次图片 API 返回 `99991672`；在讯飞开放平台新增自动审批的最小 `im:resource` 后，计算器和浏览器图片均取得真实平台 message id 与 `kind=media` 回执。契约仍要求验证 `kind=image|media`，且禁止向用户暴露本地路径 |
| E01 | `PASS` | request `e0100000-0000-4000-8000-202608030001` 在 Tower 停机时由同一 OpenClaw Job 从 `running` 到 `succeeded`；Tower 重启后只读恢复同一 `jobRef` 为 `SUCCEEDED`，OpenClaw 原生 task 恰好 1 个，重放 envelope 未创建第二个 Job且未二次消费 grant |
| E02 | `PASS` | GPT 登录恢复后，request `e0200000-0000-4000-8000-202608030003` 的原生 task 已进入 `running` 后停止 Gateway；Tower 未猜成功。Gateway 恢复后只读对账同一 jobRef 为权威 `FAILED`，只有 1 个 task、1 次 grant 消费和 1 条结果事件，没有替换 Job |
| E03 | `PASS` | E01 停机期间 completion callback 必然不可达；Tower 重启后在 60 秒窗口内扫描取得终态，`CAPABILITY_RESULT_AVAILABLE` 恰好 1 条 |
| E04 | `PASS` | request `e0400000-0000-4000-8000-202608030006` 暴露并修复 OpenClaw 多 runtime scope 下 register-local callback Map 丢失；模块级共享 registry 后，GPT-5.5 task 终态后约 627ms 经主 callback 落为 `SUCCEEDED`，只产生 1 条 Workbench 事件，无需等待 60 秒扫描；精确 callback-before-submit-response 并发由 DB-backed 回归覆盖 |
| E05-E08 | `PASS` | 在隔离 SQLite/production runtime 中分别注入迟到 `RUNNING`、`SIDE_EFFECT_UNKNOWN`、Workbench published marker 中断和 Goal timer/结束并发：终态未回退、未知副作用零自动重试、Workbench 事件恰好一次、Goal 最终保持 `ENDED` 且无迟到 timer；专项回归与数据库断言一致 |
| E09 | `PASS` | 同一隔离目录启动 9122/9124：第二实例拿不到 lease。实测发现 Next 仍残留 500 listener，修复 instrumentation 启动失败显式 `exit(78)` 后复测为退出码 78 且 9124 无监听；强杀 leader 后新实例立即接管，lease generation 9→10，旧端口消失 |
| E10 | `PASS` | SQLite `BEGIN EXCLUSIVE` 持锁约 2 秒，同时执行正式 runtime+grant 事务；事务等待后 1881ms 成功，runtime 为 ACTIVE/2h/5 Jobs、owner grant 为 5 次，既有 CapabilityRequest、WorkbenchEvent、TowerRuntimeLease 计数均未丢失 |
| F01 | `PASS` | 任务 `cmse2e5f030001cpt3f01portok` 以 2h/5 次 UI grant 启动真实 OpenClaw GPT-5.5 GUI Job；计算器完成 `161803×2026=327812878` 并保留 after 截图，request `5f01f01a-1618-4026-8000-000000000001` 只执行一次、Workbench 只唤醒一次。终端正式停止后 Task 为 `IN_REVIEW`、execution 为 `COMPLETED`、Goal 为 `ENDED`，grant 已撤销 |
| F02 | `PASS` | 独立临时 SQLite 逐项把 provider turn、无进展、连续失败、duration、child、concurrency、capability Job 上限降至最小可测值；每项均原子进入 `BLOCKED`，`GOAL_BLOCKED` 恰好一次，无额外 Job。补充修复后阻塞事务同时撤销未过期 grant |
| F03 | `PASS` | 任务 `cmse2e5f030002cpt3f03owner` 的 `expectReply=true` 飞书原生卡片取得平台 message id；OWNER 原生引用回复后通过 `replyToMessageId` 绑定既有 ask，ask 变为 `ANSWERED` 并只启动 1 次 execution。修复飞书 P2P `chat_id(oc_*)` / `open_id(ou_*)` 别名匹配后，引用卡片不再因正文退化为 `[Interactive Card]` 而丢失上下文；不同群聊仍 fail-closed。随后两次“只查询状态”均返回原生“小塔”卡片，execution 总数仍为 1、`COMPLETED`，Goal 仍为 `ENDED`，未续跑终端 |
| Claude 独立复核 | `PASS` | Claude Opus 使用精简只读模式复核当前未提交 diff 的撤权、预算阻塞、飞书引用绑定、UI 防重入、Workbench lease 与文档证据一致性；未发现 P0/P1/P2 阻断项。其未亲自执行 GUI/飞书，实机副作用证据由 Codex 执行记录承担 |
| 验收清理 | `PASS` | 隔离 9122/9123/9124 已无监听；OpenClaw Tower MCP 已恢复 `~/.tower` 生产库并重启健康；全部 OpenClaw agent 仍为 `openai/gpt-5.5`；发送者姓名解析改为关闭，避免申请非必要通讯录权限；临时 Codex MCP 条目已移除；隔离数据目录已移入废纸篓，可恢复 |

本轮修复了启停与撤权事务原子性、ACTIVE policy 刷新、预算阻塞撤权、Workbench 事件与 published marker 原子性、
UI 加载/提交失败持久状态与同步防重入、OpenClaw JSON 子进程环境、runId 对账兼容、飞书 P2P 卡片引用回复绑定、
“命令成功但无平台回执”时禁止自动重试，以及 Workbench 启动失败的 60 秒恢复退避（避免每 2 秒空转刷错）。
飞书用户可见主回复已统一为标题含“🗼 小塔”的原生卡片；截图使用飞书媒体消息交付，不再暴露本地 `file://` URL。
最终全量回归、Claude 独立复核和环境清理均已完成；本记录据此满足第 13 节放行标准。

## 13. 最终放行标准

只有同时满足以下条件，才能把“终极无人值守纵向闭环”从实现候选版改为已验收：

1. A01-A10 全部 `PASS`；
2. B01-B04 全部 `PASS`，且无 UI/数据库不一致；
3. C01-C14 全部 `PASS`；
4. D01-D03 至少在一套受控 OpenClaw 配置上全部 `PASS`；
5. E01-E10 全部 `PASS`，`SIDE_EFFECT_UNKNOWN` 从未自动重试；
6. F01-F03 全部 `PASS`；
7. Codex 和 Claude 分别签署一次独立复核记录；
8. 验收结束后没有遗留测试服务、监听端口、真实渠道测试消息重试任务或用户数据库改动；
9. 工作树只保留经过审查的代码与最终文档，不保留临时数据库、截图副本或候选版图。

## 14. 交叉验收记录模板

```text
验收人：
角色：执行 / 复核
时间：
commit SHA：
Tower / Node / pnpm / OpenClaw 版本：
隔离数据目录：<只记录 basename，不记录敏感用户路径>
验收 ID：
操作摘要：
命令退出码：
数据库断言：
外部可观察结果：
证据位置：
结论：PASS / BLOCKED / FAIL
异常与后续：
```
