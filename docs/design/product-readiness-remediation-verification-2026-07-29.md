# Tower / o-tower 产品可靠性整改复核（2026-07-29）

## 结论

当前版本已经达到 **OWNER + 可信群 + 本机 loopback + 已知代码仓库** 场景的内部产品级 Beta
标准，可以作为个人无人值守工作中枢持续使用。

这里不使用“绝对可靠”或“任意环境正式 GA”措辞。以下场景仍不在当前保证范围：

- 对来源恶意的仓库运行脚本；`REVIEW_ONLY` 已禁止 Tower 正常流程启动终端，但不是容器/虚拟机
  级恶意代码沙箱；
- 把 Tower 或 OpenClaw 控制面暴露到局域网/公网；
- 没有专用 NON_OWNER 测试账号时，对陌生私聊、陌生群和同事越权做真人黑盒测试；
- 飞书、OpenClaw、模型供应商或公司网络自身不可用时仍保证实时响应。

## 本轮真实测试发现并关闭的最后一个架构漏洞

真实飞书消息 `E2E-WORK-20260729-1433` 暴露：

1. o-tower 入口调用 `route_gateway_message(PROJECT_WORK)`；
2. Tower 正确排队，Workbench 正确创建并完成一个带 `GatewayTaskLink` 的任务；
3. 入口 Agent 因 OWNER 拥有 `tower__*`，没有在排队后停止；
4. 它尝试使用相同 `gatewayInboundId` 创建任务时被 Workbench 归属校验拒绝；
5. 随后省略 `gatewayInboundId`，又创建并启动一个无网关链接的任务。

这说明“数据库幂等 + 提示词”不足以构成完整能力边界。最终修复采用最小权限：

- o-tower OWNER ingress 只保留持久路由、只读查询和诊断工具；
- `create_task`、`start_task_execution`、项目/任务增删改等不再暴露给消息入口；
- OWNER 的写意图一律路由到项目 Workbench；
- Workbench 继续使用 `gatewayInboundId + GatewayTaskLink` 做崩溃恢复和幂等创建；
- NON_OWNER 仍只有三个 project-reader 工具；
- 同一 trusted channel 增加 sender/chat 速率限制与 queued-work 硬上限。

误建执行已停止并保留为 `IN_REVIEW` 审计证据，未删除历史记录。

## 审查项关闭情况

| 原审查项 | 状态 | 当前实现 |
|---|---|---|
| P0-1 localhost 内部 API 无认证 | 已关闭 | HMAC-SHA256：timestamp、nonce、method、path、body digest；5 分钟窗口；nonce 防重放；拒绝 foreign Origin / cross-site |
| P0-2 NON_OWNER scope fail-open | 已关闭 | 无 channel scope、空 scope、跨 workspace、ProductGroup 任一越界均 fail-closed；上下文读取再次校验 |
| P0-3 REVIEW_ONLY 只靠提示词 | 应用级关闭 | 路由降级为讨论；`create_task` 与 PTY 启动服务端拒绝；PROVISION 不能直接 FULL_WORK |
| P0-4 Tower 无系统监督 | 已关闭 | 用户可选无人值守服务：macOS LaunchAgent；Windows Task Scheduler + 崩溃重启包装器；均保持 loopback、独立日志与 status/install/remove |
| P1-1 撤权残留 | 已关闭 | 安装时对旧平台、binding、channel policy 做差集清理；空策略 deny-all；卸载清理完整 |
| P1-2 生产依赖漏洞 | 已关闭 | `pnpm audit --prod` 为 0 known vulnerabilities |
| P1-3 无限流/队列上限 | 已关闭 | sender 30/min、chat 120/min、trusted chat queued work 最多 50 |
| P1-4 本地文件权限 | 基线关闭 | `~/.tower` 700；DB、备份、HMAC key、服务日志和 state 600；自动备份与保留策略 |
| P1-5 远程项目并发重复 | 已关闭 | 规范化 `repositoryKey` 唯一约束；并发 P2002 回收；PROVISION 固定 REVIEW_ONLY；独立 SET_MODE |
| OpenClaw 入口可越过 Workbench | 已关闭 | OWNER ingress 无直接写/终端工具；写意图只允许 PROJECT_WORK |

## 可靠性不变量

1. 每条需要处理的外部消息先持久化，再做任何动作。
2. OpenClaw 入口不直接修改 Tower，不直接创建任务，不直接启动 CLI。
3. 只有绑定的项目 Workbench 能使用该 inbound 的 `gatewayInboundId` 创建子任务。
4. 一个 inbound 最多绑定一个 `GatewayTaskLink`。
5. PTY 写入不等于消费；必须显式 batch ACK。
6. Workbench 审查后，`Task=DONE` 与 `FINAL_RESULT/PENDING` 同事务提交。
7. 外部平台投递采用 at-least-once + 稳定去重；`SENT_UNVERIFIED` 不盲目重发。
8. REVIEW_ONLY 项目不能创建可执行任务或启动 PTY。
9. NON_OWNER 无 scope 时 fail-closed；返回内容不含 `localPath`、个人日报或个人任务聚合。
10. 服务重启后从 SQLite inbox/outbox 恢复，不依赖终端画面或内存状态。

## 最终验证记录

| 验证 | 结果 |
|---|---|
| 生产构建 | `pnpm build` 通过 |
| TypeScript | `pnpm exec tsc --noEmit` 通过 |
| 全量自动测试 | 233 个测试文件通过、6 个跳过；2149 个测试通过、27 个 todo |
| 生产依赖审计 | `pnpm audit --prod`：No known vulnerabilities |
| 内部 API 边界 | 本机未签名请求返回 401；foreign Origin 返回 403 |
| 服务监督 | Tower LaunchAgent 与 OpenClaw LaunchAgent 均为 running；Tower `/missions` 返回 200 |
| 本地权限 | 数据目录/数据库目录 700；SQLite 主文件、WAL/SHM、HMAC key、state、服务日志均为 600 |
| OpenClaw OWNER 工具面 | 仅路由、项目只读查询和诊断；不包含 `create_task`、`start_task_execution` 或增删改工具 |
| 飞书讨论链路 | `E2E-DISCUSS-20260729-1430`：真实 @、引用原消息、项目讨论卡片成功 |
| 飞书工作链路 | `E2E-WORK-20260729-1433`：Workbench 创建、审核、引用原消息回传成功；同时发现并关闭入口重复建任务漏洞 |
| 飞书策略加固复测 | `E2E-POLICY-20260729-1628`：仅调用 route/read/complete；写工具调用 0；任务总数前后均为 819 |
| 飞书新卡片复测 | `E2E-CARD-20260729-1800`：排队、任务创建、任务完成三张新版卡片均引用原消息成功；字段网格、状态中文化、目标/验收结果分区正确 |

最终飞书复测返回了两个最近任务，并由 `complete_gateway_discussion` 投递到原消息线程。当时的入口会话记录显示三段调用链且未调用任务写工具。

> 2026-08-05 后续架构更新：上述三段链路只是历史验收证据，已被单次
> `route_gateway_query` 取代。新链路不创建 `GatewayInbound`、会话或 Workbench 事件。

真实渠道验收曾使用公司环境截图取证；该截图不属于公开产品文档，现已从仓库与 GitHub Pages 资产中移除。自动化契约测试继续覆盖字段、状态、引用关系与重复投递边界。

## 运维与故障定位

正常使用时优先看 Tower 自带诊断，而不是靠 Computer Use 猜测：

1. `diagnose_gateway_request`：按 inboundId 或平台 message ID 返回六阶段时间线；
2. `get_gateway_runtime_health`：关联 OpenClaw/Hermes 健康和脱敏日志；
3. Missions Workbench 卡片：generation、heartbeat、active batch、pending、blocked reason；
4. `tower service status`：确认 macOS LaunchAgent 或 Windows Task Scheduler，以及 HTTP/WS；
5. 自动备份：启动后周期检查，每日一份，默认保留最近 7 份自动备份。

Computer Use 仍有价值，但定位为 GUI 黑盒验收：验证真实 @、引用回复、卡片样式和桌面应用行为；
它不是无人值守系统的唯一可观测性来源。

## 尚需后续完成的 GA 项

| 项目 | 当前影响 | 建议 |
|---|---|---|
| 恶意仓库强隔离 | 仅影响不可信代码执行 | 容器/VM、只读挂载、默认断网、一次性 executor |
| 真人多身份黑盒账号 | 当前依赖结构测试证明 NON_OWNER/陌生群边界 | 建专用 OWNER/NON_OWNER/未知群测试矩阵 |
| OpenClaw 控制面设置 | 当前只监听本机时风险受限 | 关闭 insecure control UI、配置 plugin allowlist，再考虑网络暴露 |
| 飞书 contact readonly scope | 产生兼容告警，不影响已验证消息收发 | 在应用后台补 scope |
| 原子版本部署/自动回滚 | 当前服务崩溃会拉起，但坏构建仍需人工恢复 | 引入 version dir + current symlink + 健康失败回滚 |
| 审计数据保留期 | 长期运行会累计消息审计 | 设置 GatewayInbound/Delivery 生命周期与导出策略 |

## 文档与图

- 总体安全与能力路由：
  [`o-tower-personal-assistant-security-and-operations.md`](./o-tower-personal-assistant-security-and-operations.md)
- Workbench 主架构：
  [`workbench-reliable-gateway-architecture.md`](./workbench-reliable-gateway-architecture.md)
- 可编辑总体架构图：
  [`../diagrams/o-tower-personal-assistant-target-architecture.drawio`](../diagrams/o-tower-personal-assistant-target-architecture.drawio)
- 可编辑访问与工作时序图：
  [`../diagrams/o-tower-access-routing-sequence.drawio`](../diagrams/o-tower-access-routing-sequence.drawio)
- Workbench 架构、状态机与详细时序：
  [`../diagrams/workbench-reliable-architecture.drawio`](../diagrams/workbench-reliable-architecture.drawio)、
  [`../diagrams/workbench-batch-state-machine.drawio`](../diagrams/workbench-batch-state-machine.drawio)、
  [`../diagrams/workbench-gateway-sequence.drawio`](../diagrams/workbench-gateway-sequence.drawio)
