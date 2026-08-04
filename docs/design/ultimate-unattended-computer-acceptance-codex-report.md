# 终极无人值守电脑 · Codex 实机验收记录

## 2026-08-03 最终结论（覆盖下方阶段性记录）

当前候选工作树判定 **PASS**：B04 显式失败态、E05-E08 真实故障注入、F01-F03 OpenClaw GPT-5.5 / 飞书闭环均已补齐；飞书截图改为原生媒体、小塔主回复改为原生卡片，引用卡片回复可绑定原 ask，普通状态查询不续跑终端。最终全量为 257 files passed / 6 skipped、2287 tests passed / 27 todo；lint、typecheck、production build、release smoke、diff check 均通过。Claude 独立只读复核无 P0-P2 阻断项。隔离服务与临时 MCP 已清理，OpenClaw 已恢复生产 Tower 数据库且四个 agent 均为 `openai/gpt-5.5`。

下方内容是验收过程中的阶段性记录，保留用于说明问题如何被发现和修复；其中 `PARTIAL/BLOCKED` 已被本节和主验收文档的最终证据取代。

> 本记录针对 `codex/ultimate-unattended-runtime` 当前工作树，验收基线 commit 为
> `643934df54cd9739264cb30f389ae4dc9cff19e0`。当前工作树包含本轮待审代码与验收修复，
> 因此不把“工作树干净”误报为通过。

## 结论

当前结论为 **阶段性 PASS，最终放行仍 BLOCKED**。

- Gate A 的类型、lint、全量单测、MCP bundle、production build、迁移幂等和发布包 canary 已通过。
- Gate B 的 B01-B03 已用 Computer Use + 隔离 SQLite 完成黑盒/白盒闭环；B04 详情页全尺寸和 390×844 看板侧栏最终态、Tab 焦点环已通过，显式失败态和完整六状态矩阵仍未完成。
- Gate C 自动化契约与安全不变量通过；真实 D01-D03 通过。飞书计算器与浏览器的 GPT-5.5 GUI 执行通过；补充最小 `im:resource` 权限后，计算器和浏览器截图均取得原生媒体回执，手机主入口通过。
- Gate E 的完整真实进程故障注入和 Gate F 的长循环尚未执行完，不能签最终 release PASS。

## 本轮修复

1. `scripts/release-smoke.js`：适配 npm 11 严格 lifecycle 白名单。为本地 tarball 使用可信 `file:` 身份，预建全局 prefix 的 `lib`，并只放行 Tower/Prisma/node-pty/esbuild/fsevents 所需脚本。
2. `bin/tower.mjs`：首次启动在 `prisma db push` 前显式创建权限为 `0600` 的 SQLite 文件，修复 Prisma 6.19 对缺失数据库只返回泛化 `Schema engine error` 的发布包启动失败。
3. OpenClaw 实机：四个 agent 均固定为 `openai/gpt-5.5`；Operator 采用 Gateway `security=full, ask=off`，Peekaboo preflight 为 `gui/remote`。旧 `codex-exec-mcp` 已移除，不参与任何验收。
4. Operator GUI 宏：计算器宏按一次性动作序列执行并发布完整窗口证据；浏览器宏验证真实 URL、标题和页面可见文本。
5. `task-page-client.tsx`：390px 详情页由左右分栏切换为上下分栏，文件工具区同时改为上下布局，消除“图谱”页签和 Monaco 提示被裁切的问题；桌面视口仍保持左右拖拽。
6. `task-detail-panel.tsx`：侧栏宽度在手机上限制为可见区域，页签与无人值守/详情操作分两行换行，修复固定 600px 把关键按钮推到屏幕外的问题。
7. `instrumentation-node.ts`：runtime lease 竞争失败时显式以退出码 78 终止。修复 Next 捕获 instrumentation 异常后仍保留 HTTP listener、持续返回 500 并被 supervisor 误判为存活的问题。
8. 飞书交付：强制非流式卡片渲染；外部操作结果必须先发“小塔”结构化卡片、再发原生图片，并校验图片回执的 `kind=image|media`。把“复制到 outbound cache”改为仅表示 `cache_ready`，禁止再冒充已上传。
9. `workbench/coordinator.ts`：失败的 Workbench 恢复增加 60 秒退避。实机发现缺少 `localPath` 的父任务会让同一持久事件每 2 秒失败一次；现在事件仍为 `PENDING`，新事件和 BUSY 事件仍即时处理，但相同失败不会在每个 scanner tick 空转。

## Gate A 证据

| 项目 | 结果 | 证据 |
|---|---|---|
| Prisma / typecheck | PASS | `prisma generate`、`tsc --noEmit` 退出码 0 |
| lint | PASS | `pnpm lint` 退出码 0；所有 UI/leader 修复后再次复跑通过 |
| 全量 Vitest | PASS（记录 1 次负载抖动） | 首轮 256 files passed、6 skipped、2272 tests passed、27 todo。最终并发复跑时仅 `cli-plugin-service` 1 个用例触发 5s timeout，其余 2271 passed；随即单文件复跑 7/7、2.76s 通过，未能复现 |
| MCP bundle | PASS | `dist/mcp-server.cjs` 4.0 MB |
| production build | PASS | Next.js 16.2.1 standalone 构建成功；响应式与 leader 修复后重复构建仍通过，仅保留既有 Turbopack NFT 动态追踪 warning |
| A07 release smoke | PASS | 合并消息 skill 后临时全局安装检查 9 个内嵌路径、`tower v0.3.1`、全新建库、33 migrations、fixture plugin、API/Summary/Assistant/Terminal 全部通过 |
| A08 migration idempotency | PASS | 隔离库连续执行两次，0029-0033 在 `AppliedMigration` 中各恰好 1 行 |
| 修复后 CLI 单测 | PASS | `tests/unit/bin/tower-cli.test.ts`：3/3 |

## Gate B 证据

隔离目录 basename：`tower-e2e-unattended-UOSif8`；服务绑定 `127.0.0.1:9122`，未配置真实外发目标。

### B02 启用

Computer Use 在任务 `acceptance-task` 的 production 详情页打开授权对话框。界面显示默认 8 小时、20 次；只读 capability `computer.gui.act / R2` 需要显式勾选，界面未暴露 OWNER destination 或 Operator `agentId`。

确认后数据库立即满足：

- runtime：`ACTIVE / ACTIVATED`，`maxDurationMs=28800000`，`maxCapabilityJobs=20`；
- grant：`human.message.send / R2 / OWNER_HOME_ROUTE`，`usedCount=0`，`maxUses=20`，未撤销；
- `Task.unattended=1`；
- 刷新页面后仍显示“无人值守已授权”。

### B03 停用

Computer Use 点击“确认关闭”后：

- runtime：`ENDED / DEACTIVATED`；
- 原 grant 的 `revokedAt` 非空；
- `Task.unattended=0`；
- runtime/grant 总数仍为 1，没有重复记录；刷新后保持“启用无人值守”。

### B04 响应式与可访问性

- production 详情页：390×844 使用 vertical panel group，两个 panel 均为 390px 宽；1280×720 和 1440×900 使用 horizontal panel group。三个视口 `overflowX=0`，可见交互控件均未越界。
- 授权弹窗：390px 时为 358×361，完整位于视口；1280px 时为 384×321，完整位于视口。
- 选项映射：2/8/24 小时对应 120/480/1440 分钟；5/20/50 次对应同值。`computer.gui.act / R2` 默认未勾选；弹窗不包含 OWNER destination、credential/token/secret/API key 或 `agentId`。
- 键盘：ArrowDown 可展开候选项；Esc 关闭弹窗后焦点返回“启用无人值守”。
- 首次 390px 实测发现并修复两处真实缺陷：详情页固定水平分栏导致页签裁切；看板侧栏固定 600px 导致无人值守按钮不可见。
- 2026-08-03 使用当前 production build、隔离库 `tower-e2e-unattended-UOSif8` 与 390×844 Chrome 补做侧栏黑盒复核：`scrollWidth=390`，授权按钮、执行/变更/备注/查看详情均在可视区；Tab 从“无人值守已授权”移至“查看详情”，后者显示可见 focus ring。显式失败态和完整六状态矩阵仍未完成，因此 B04 仍为 `PARTIAL`。
- 同次复核发现 3000 端口旧进程因构建产物已替换而产生 `ChunkLoadError`；改用当前构建的隔离 9122 服务后状态正常加载。该旧进程环境问题未作为产品失败或通过证据。

## Gate D 与飞书主入口

### D01/D02

- `openclaw plugins inspect tower-capability-bridge`：loaded；`plugins doctor` 无插件错误；配置校验通过。
- 空 capability 配置规范化为 0 条；public discovery 不含 `agentId` 或 `operator`。
- 临时 R1 `computer.test.observe` requestId：`d02f0000-0000-4000-8000-202608030001`。
- 首次提交：`ACCEPTED + tower-capability:<requestId>`；OpenClaw 原生 task id `a48e26cc-877a-4713-b954-64b59b3a6311`，终态 `succeeded`。
- Tower 对账：`SUCCEEDED`，evidence 指向同一 OpenClaw task；Workbench 中 `CAPABILITY_RESULT_AVAILABLE` 恰好 1 条。
- 相同 envelope 重放返回相同终态/revision/jobRef，没有第二次任务；验收后已恢复原插件配置。

### 飞书计算器（PASS）

- 唯一标记：`TOWER-ACCEPT-GPT55-FEISHU-CALC-20260803-C`。
- 真实入口：iFlytek 本地飞书“起飞”会话。
- 回执：`openai/gpt-5.5`、`preflight=gui`、`mode=basic-decimal`、可见 `42×8 / 336`。
- 动作：Escape/All Clear → 输入 `27+15` → Return → 输入 `*8` → Return。
- 首次回复确实错误降级为本地路径文本，原“附件已发送”结论已撤销。修复后使用标记 `TOWER-ACCEPT-FEISHU-IMAGE-20260803` 重发同一计算器证据，平台 message id 为 `om_x100b6836191ee0a03861561a9e897f5`，回执 `parts[0].kind=media`；飞书会话列表显示 `Tower: [Image]`。

### 飞书浏览器（PASS）

- 唯一标记：`TOWER-ACCEPT-GPT55-FEISHU-BROWSER-20260803-C`。
- 回执：`openai/gpt-5.5`、`preflight=gui`、最终 URL `https://docs.openclaw.ai`、标题 `OpenClaw Docs`、可见文本含 `Install`。
- 首次回复确实错误降级为本地路径文本，原“附件已发送”结论已撤销。修复后使用标记 `TOWER-ACCEPT-FEISHU-BROWSER-IMAGE-20260803` 重发浏览器证据，平台 message id 为 `om_x100b683610a5a4a03862c795ce05a25`，回执 `parts[0].kind=media`。

### 飞书卡片与媒体复验

- `TOWER-ACCEPT-FEISHU-NATIVE-MEDIA-20260803` 的结构化发送已取得平台回执，`parts[0].kind=card`；Computer Use 在“起飞”会话确认可见“✅ 小塔 · 手机端交付验收”，证明卡片模式已修复。
- 同一次图片上传被讯飞飞书 API 以 `99991672` 拒绝，缺少 `im:resource:upload` 或 `im:resource` 权限。
- OpenClaw 随后错误降级为包含本地路径的卡片并返回 `ok=true`。执行契约现已要求检查媒体回执必须包含 `kind=image|media`，文本/卡片降级一律判失败。
- 已在讯飞开放平台只新增自动审批的最小权限 `im:resource`（上传图片/文件）。随后计算器与浏览器图片均取得 `kind=media` 回执，原生媒体交付改为 `PASS`。
- 2026-08-03 再次登录讯飞应用 `Tower` 的权限与事件页核对：`im:message`、`im:message.group_msg`、`im:message.p2p_msg:readonly`、`im:resource` 均为 Added 且当前变更已发布；`im.message.receive_v1` 已订阅。内联 `interactive` 卡片走消息 API，不需要额外 CardKit 模板权限。
- OpenClaw 的非内置插件显式 allowlist 已固定为 `codex / feishu / openclaw-weixin / zai / tower-capability-bridge`；重启后 `plugins doctor` 为 `No plugin issues detected`，四个业务 agent 仍全部为 `openai/gpt-5.5`。

## Gate E 恢复与故障注入

### E01 / E03：Tower 停机与丢 callback

- requestId：`e0100000-0000-4000-8000-202608030001`；jobRef：`tower-capability:<requestId>`；OpenClaw task：`f5b7253c-eebe-41aa-817c-654370e87677`。
- Tower 停机后，OpenClaw task 独立从 `running` 到 `succeeded`；隔离库仍停留在 `ACCEPTED`，证明 callback 未能写入 Tower。
- Tower 重启后在 60 秒窗口内只读恢复为 `SUCCEEDED`，revision=`1785730346833`，证据指向同一 OpenClaw task；`CAPABILITY_RESULT_AVAILABLE` 恰好 1 条。
- 重放同一 envelope 返回同一终态/jobRef；OpenClaw task 数仍为 1，computer grant `usedCount=1/5`，未发生第二次执行或消费。
- Calculator 证据：`/Users/liujunping/.openclaw/media/outbound/e01-tower-recovery.png`；已目视确认完整窗口显示 `42×2 / 84`。

### E02：OpenClaw 执行中退出

- GPT 登录恢复后用新 request `e0200000-0000-4000-8000-202608030003` 重做：OpenClaw 原生 task `ffd9805f-0a6e-428b-82cc-bf594c1c345b` 已进入 `running`，随后停止 Gateway。
- Gateway 停机期间 Tower 保持运行且未猜测成功；恢复后只读对账同一 `tower-capability:<requestId>`，权威终态为 `FAILED`（Gateway 退出导致 app-server client 关闭）。
- Tower 最终只消费一次 grant、保留一个 OpenClaw task，并只发布一条 `CAPABILITY_RESULT_AVAILABLE`；没有替换 Job 或第二次外部执行。E02 按“中断后保守对账同一 Job”判 `PASS`，不把权威失败包装成成功。

### E04：completion/submit 与 OpenClaw 终态落盘竞态

- 真实 fixture request `e0400000-0000-4000-8000-202608030006` 使用 `computer.test.observe / R1` 和 `openai/gpt-5.5`，OpenClaw task `26d4f9d6-d0fa-4d9e-becd-a59dc8e5e587` 成功。
- 实测暴露 OpenClaw 会在不同 runtime scope 注册 gateway method 与 `subagent_ended` hook；原 register-local callback Map 在 hook scope 中为空，导致只能依赖 60 秒扫描。
- 插件改为模块级共享 callback registry，并同时按 sessionKey/runId 索引。修复后 task `endedAt=1785737073439`，Tower `resultEventPublishedAt=1785737074066`，约 627ms 内由主 callback 落为 `SUCCEEDED`，且 Workbench 事件恰好 1 条。
- Tower 的短时只读 settle loop 仍覆盖“hook 先于 OpenClaw task 终态快照”的约 300ms 落盘窗口；精确 callback-before-submit-response 由 DB-backed 并发回归覆盖，真实插件链路验证了不等待低频扫描。

### E09：runtime leader

- 首轮实测：第二实例拿不到 lease，但 Next instrumentation 异常被捕获后仍在 9124 监听并返回 500；据此增加显式退出修复。
- 修复后：竞争实例 0.39 秒内以退出码 78 结束，9124 无 listener；原 leader 的 9122 仍正常返回 307。
- 强制终止 leader 后，新实例在 9124 立即接管同一 lease，generation 从 9 增至 10；9122 无 listener，9124 正常返回 307。

### E10：SQLite busy

- 对隔离 SQLite 持有约 2 秒 `BEGIN EXCLUSIVE`，并发执行与 UI 启用相同的 runtime+grant 原子事务。
- 事务在 busy timeout 内等待后成功，实测 1881ms；runtime=`ACTIVE/ACTIVATED`、`maxDurationMs=7200000`、`maxCapabilityJobs=5`，owner grant `maxUses=5`。
- 既有 `CapabilityRequest=1`、`WorkbenchEvent=1`、`TowerRuntimeLease=1` 均保留，没有丢记录。
- E04 已补真实插件链路；E05-E08 仍只有专项自动化证据。本轮复跑恢复/预算/leader 测试通过，不能替代其余各自真实故障注入。

### Workbench 失败恢复退避

- 在隔离验收库启动 production runtime 时，历史 `PENDING` 事件因项目没有 `localPath` 每约 2 秒重复失败，违反长循环“不空转”的方向性要求。
- 修复后新增回归证明：第一次失败保留事件并记录 `lastError`；退避窗口内第二次扫描 `scanned=0`；60 秒后条件允许时仍可恢复同一事件。
- production build 通过；同一隔离库实机运行约 20 秒只记录首次失败，后续 2 秒扫描未重复报错。专项测试 `coordinator + policy` 为 34/34，通过后的聚焦验收套件为 75/75。

## Gate F 长循环补验

- 使用隔离任务 `cmscu0u930001cpt3y4zxcglm` 通过 production UI 签发 2 小时/5 次授权；数据库立即得到 `ACTIVE`、`maxDurationMs=7200000`、`maxCapabilityJobs=5`，OWNER grant `maxUses=5/usedCount=0`。
- 随后启动真实 Claude provider turn，要求先持久化 600 秒 wake 条件，再只提交一次 `computer.test.observe / R1`。终端持续约 3 分钟只有模型 spinner；runtime 始终 `lastEventKind=ACTIVATED`、`nextWakeAt=null`、`providerTurns=0`，CapabilityRequest 为 0。
- 为避免继续耗费额度，使用正式 Stop 路径结束终端；系统同时把 Goal 原子结束为 `ENDED / TERMINAL_STOPPED`。因此安全停机通过，但 F01 的“provider 持久 WAITING → Job → Workbench → DONE/REVIEW”仍为 `BLOCKED`，不把终端静默算成功。

## 尚未放行项

1. B04 显式失败态和完整六状态矩阵；详情页三个指定视口、390×844 看板侧栏最终态与 Tab 焦点环已通过。
2. E05-E08 的真实故障注入；E01-E04、E09、E10 已完成实机或真实插件链路注入，`SIDE_EFFECT_UNKNOWN` 目前仍只有自动化零重试证据。
3. F01-F03 的长时间 Goal、预算阻塞与 OWNER ask/reply 闭环。

在以上项目完成前，整体结论保持 `BLOCKED`。发布包启动阻断、GPT-5.5 GUI 链路、飞书卡片和原生图片交付均已修复；剩余阻断仍是 B04/E/F 中列出的完整验收项。
