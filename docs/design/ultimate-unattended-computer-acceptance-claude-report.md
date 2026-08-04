# 终极无人值守电脑 · Claude 独立验收记录

## 2026-08-03 最终候选 diff 独立复核（覆盖旧阶段性结论）

```text
VERDICT: PASS

FINDINGS:
- P0: None
- P1: None
- P2: None（无阻断项）

EVIDENCE_REVIEW:
- Goal 结束与预算 BLOCKED 均在同一数据库事务中撤销未过期 capability grant；相邻测试覆盖撤权与事件去重。
- UI 以同步 mutation ref 防止同一事件轮重复提交，并提供持久 role=alert 失败态与可重试路径。
- 飞书 P2P oc_ chat_id / ou_ open_id 别名只在同平台、唯一 platformMessageId 命中时放行；不同群聊仍 fail-closed。该判断依赖平台 message id 全局唯一索引，以及飞书引用回复只能引用同一会话消息的信任边界。
- Workbench 的 envless parent 推导仍由必填 leaseToken 和事务内二次校验约束；未形成 fail-open。
- 验收文档明确区分 Codex 实机执行证据与 Claude 只读复核，没有把 Claude 未执行的 GUI 冒充为 Claude 实测。

SIGNOFF:
本人作为独立代码审查人，仅基于当前未提交 diff（runtime、policy、gateway-router、unattended-goal-control、coordinator、tower-mcp-env、batch route 及相邻测试与验收文档）与文档所记录之证据进行只读复核，未修改任何文件，未亲自执行 GUI / 飞书 / OpenClaw 实机验收。就本次代码变更范围，未发现 P0/P1/P2 级安全不变量破坏，判定 PASS。

签署人：Claude（Opus，独立复核）
日期：2026-08-03
```

以下为 2026-08-02 基线提交的首次阶段性记录，保留作审计历史；其中 BLOCKED 项已由上方最终复核与 Codex 实机记录取代。

> 本文件是 Claude 一侧的独立验收结论，**不修改** Codex 维护的
> [`ultimate-unattended-computer-acceptance.md`](./ultimate-unattended-computer-acceptance.md)。
> 两侧使用同一提交、同一验收编号，交叉复核后各自签署。

## 元信息

| 项 | 值 |
|---|---|
| 验收人 | Claude（Opus 4.8） |
| 角色 | 执行 |
| 时间 | 2026-08-02 |
| commit SHA | `643934df54cd9739264cb30f389ae4dc9cff19e0`（`codex/ultimate-unattended-runtime`） |
| 工作树 | 仅 4 个设计文档改动（3×M + 1×新增），无代码改动 |
| Node / pnpm / vitest | v24.18.0 / 10.33.0 / 4.1.1 |
| OpenClaw | 本次未安装/未验证（无稳定本机 OpenClaw + 无专用 Operator） |
| 隔离数据目录 basename | `tower-e2e-unattended-PJaFMM`（A08 用，已清理） |
| 关键环境限制 | 沙箱**无外网**（`fonts.googleapis.com` 不可达）+ **无 Computer Use** + 无真实 OpenClaw/Operator/测试渠道 |

## 结论速览

| 结论 | 数量 | 说明 |
|---|---|---|
| `PASS` | Gate A 的 A01–A05、A08、A09（静态）、A10；Gate C/E 的单测层 | 代码/迁移/单测层可证明的部分全部通过 |
| `BLOCKED` | A06、A07、A09（打包 canary 部分）；Gate B 全部；Gate D 全部；Gate E 端到端；Gate F 全部 | 受限于「无外网 / 无 Computer Use / 无真实 OpenClaw」，非代码错误 |
| `FAIL` | 无 | 本次未触发任何安全不变量破坏或 UI/DB/回调矛盾 |

> 说明：`BLOCKED` 严格遵循验收方案第 1 节规则——代码未被证明错误，但缺少真实环境时不宣称通过。

## Gate A — 代码、迁移与发布包

| ID | 结论 | 证据 / 退出码 |
|---|---|---|
| A01 基线与工作树 | `PASS` | `git rev-parse HEAD = 643934d…`；`git status --short` 仅 4 个设计文档，无非验收代码改动 |
| A02 Prisma + 类型 | `PASS` | `pnpm exec prisma generate` 成功；`pnpm exec tsc --noEmit` → `TSC_EXIT=0` |
| A03 Lint | `PASS` | `pnpm lint`（eslint）零输出、无 error/warning |
| A04 全量单测 | `PASS` | `pnpm exec vitest run` → exit 0；**255 files passed / 6 skipped**，**2266 tests passed / 27 todo**，耗时 209.68s。与 Technical Spec 记录数值**完全一致**（交叉复跑吻合） |
| A05 MCP bundle | `PASS` | `pnpm mcp:build` → `dist/mcp-server.cjs` 4.0mb，Done in 95ms |
| A06 Production build | `BLOCKED`（环境） | `pnpm build` → exit 1。日志 491 行，**唯一错误**是 `next/font/google` 拉取 `Geist Mono` 失败：`There was an issue establishing a connection … fonts.googleapis.com`。第 476 行前编译全部正常。根因是离线沙箱，非代码缺陷。**复跑建议**：联网环境或预置字体缓存后重跑 |
| A07 发布包 canary | `BLOCKED`（依赖 A06） | `release:smoke` / `release:pack:check` 依赖 `.next/standalone` 产物，A06 未产出故无法执行 |
| A08 迁移幂等 | `PASS` | 隔离库连续两次 `tsx scripts/run-migrations.ts`：**首次应用 33 个（0001–0033 全部）、二次 0 个（全 skip）、两次均无 `FAILED`**；`AppliedMigration` 共 33 行，0029–0033 各恰一行。顺带证明老迁移在 `db push` 库上也幂等 |
| A09 安装内容 | `PASS`（历史记录） | 2026-08-02 首次复核时四个旧 skill 均齐全；2026-08-03 `tower-ask` 已合并进 `tower-bridge`，当前发布包要求 `tower/tower-bridge/tower-goal` 三个 skill |
| A10 图文一致 | `PASS` | 三份设计文档无「新服务/新进程/独立数据库」误述，反而明确声明「Capability Port 为虚线逻辑边界、不得翻译成新服务」「不引入 Kafka/Redis/共享 DB/Event Bus」；状态所有权（Tower=Project/Task/Goal/审查，OpenClaw=渠道/外部 Job/凭据/Operator 路由）与代码目录（`src/lib/gateway`、`src/lib/unattended-goal`、`src/lib/workbench`）及迁移一致；架构文档诚实地把真实 Operator E2E 标为「待部署验证」，未谎报为已完成 |

## Gate C — Capability 契约与安全不变量（单测层）

单独复跑验收方案 §5 列出的 9 个关键测试文件：**9 files / 67 tests 全 passed，exit 0**。

- `capability-contract` / `capability-runtime` / `capability-migration` / `openclaw-task-client`
- `unattended-goal/{runtime,policy,migration}`
- `workbench/coordinator`
- `harness/capabilities/completions/route`

这为 C01–C14 提供**代码级证据**（discovery schema、无授权 fail-closed、`requestId` 去重与变更拒绝、非法 schema 不消费 grant、乱序不覆盖终态、`SIDE_EFFECT_UNKNOWN` 终态、completion callback token/localhost 校验、单路迁移等均有对应单测）。

> 限制：Gate C 的**完整** PASS 还要求运行时 + DB 断言 + Computer Use 黑盒，本次只能到单测层。运行时端到端记 `BLOCKED`。

## 无法执行的部分（诚实标注）

| Gate / 项 | 结论 | 原因 |
|---|---|---|
| Gate B（B01–B04 本地 UI+DB 闭环） | `BLOCKED` | 需 **Computer Use** 做用户黑盒 UI 操作（我不具备），且 A06 使 production 服务起不来。**不覆盖** Codex 预验收记录里的 B01 `PASS` / B02 `FAIL`——那是另一执行人的结论 |
| Gate D（D01–D03 OpenClaw 集成） | `BLOCKED` | 需稳定本机 OpenClaw + 已加载插件 + 专用测试 capability |
| Gate E（E01–E10 故障注入） | 单测层部分覆盖 / 端到端 `BLOCKED` | 乱序、幂等、side-effect-unknown、Workbench 唤醒有单测覆盖（见 Gate C）；真实进程重启/丢回调/租约争用的运行时注入需 stable runtime + OpenClaw |
| Gate F（F01–F03 Goal 长循环） | `BLOCKED` | 需真实只读 Operator Job + OWNER 测试渠道 + 运行时 |

## 给交叉验收的排查线索（非结论）

1. **验收方案第 4.2 节的 `/tmp` 命令在 macOS 上会直接失败**：`prepare-e2e-db.mjs` 用 `os.tmpdir()` 校验目录前缀，macOS 下等于 `$TMPDIR`（`/var/folders/…/T`）而非 `/tmp`，照抄文档的 `mktemp -d /tmp/tower-e2e-…` 会被拒。我改用 `mktemp -d "${TMPDIR%/}/tower-e2e-unattended-XXXXXX"` 后 A08 全绿。建议 Codex 侧把文档命令改为 `${TMPDIR:-/tmp}`，或在实现里同时接受 `/tmp`（macOS `/tmp`→`/private/tmp` 软链）。
2. **B02 之前的 `SQL error or missing database` + 查不到 runtime/grant**：与上一条同源风险——若隔离运行时未正确 pin 到 prepare 出来的库（env/`TOWER_DATA_DIR` 传递或 `/tmp` vs `$TMPDIR`），会连到错误/未建表的库，表现正是「UI 成功但白盒查空 + leader 退出」。建议定位时先 `sqlite3 <库> 'SELECT * FROM TowerRuntimeLease'` 确认服务与验收查询指向**同一物理文件**。（需运行服务，超出我无 Computer Use 的范围，仅作线索。）

## 交叉验收记录

```text
验收人：Claude (Opus 4.8)
角色：执行
时间：2026-08-02
commit SHA：643934df54cd9739264cb30f389ae4dc9cff19e0
Tower / Node / pnpm / OpenClaw 版本：@tower-org/cli@0.3.1 / v24.18.0 / 10.33.0 / 未验证
隔离数据目录：tower-e2e-unattended-PJaFMM（已清理）
验收 ID：A01–A10 + Gate C/E 单测层
操作摘要：见上表
命令退出码：tsc=0, vitest=0, mcp:build=0, run-migrations×2=0/0, build=1(仅字体离线)
数据库断言：AppliedMigration 33 行、0029–0033 各一次、二次迁移 0 apply
外部可观察结果：本次无外部动作（未发任何渠道消息，符合 Gate A/B 无外部副作用要求）
证据位置：/tmp/tower-accept-{vitest,build,ce}.log、/tmp/a08-mig{1,2}.log（会话内临时）
结论：A01–A05/A08/A09(静态)/A10/Gate C 单测层 = PASS；A06/A07/Gate B/D/F = BLOCKED；无 FAIL
异常与后续：A06 需联网重跑；B/D/F 需 Computer Use + 真实 OpenClaw；见上文排查线索
```
