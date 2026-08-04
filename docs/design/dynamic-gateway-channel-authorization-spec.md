# Gateway 群聊动态授权与范围绑定 Spec

> 状态：已实现（0.3.1 MVP，使用版本化 SystemConfig）
> 日期：2026-08-03
> 目标读者：负责实现的 Claude / Codex 及代码审查者

## 1. 目标

移除飞书群接入时手工查找、复制 `chat_id` 并在 Tower 设置页维护白名单的要求。群 ID、平台和发送者身份必须从当前网关消息上下文获取。

OWNER 在机器人所在的任何群中都能 `@Tower` 使用 OWNER 能力，并能在当前群内完成授权、绑定、解绑和撤销。其他成员的权限由当前群的持久授权状态决定。

首期必须支持 OpenClaw + 飞书；数据模型和 Tower Gateway 判断保持平台无关，便于以后支持 Hermes、微信等渠道。

## 2. 权限语义（不可改变）

| 群状态 | OWNER | 其他成员 |
|---|---|---|
| 未授权 | 可 `@Tower` 使用 OWNER 能力、授权或绑定 | `@Tower` 后提示“本群未经授权” |
| 已授权、未绑定 | 拥有 OWNER 能力 | 可查询所有工作区、所有项目，只读 |
| 已授权、已绑定 | 拥有 OWNER 能力 | 仅可在绑定工作区/项目范围内查询，只读 |
| 已撤销 | 可重新授权或绑定 | 不可使用 |

补充规则：

1. OWNER 权限由已配置的真实平台 sender ID 判断，不使用昵称、群名或模型推断。
2. OWNER 权限不受群绑定范围限制；绑定只约束 NON_OWNER。
3. “授权本群”将 NON_OWNER 范围设为 `ALL`。
4. 在未授权/已撤销群执行“绑定工作区/项目”，等价于“授权 + 绑定”。
5. “解除绑定”回到 `ALL`，不是撤销授权。
6. “撤销本群授权”后 NON_OWNER 不可使用，保留审计记录。
7. 所有群消息仍要求显式 `@Tower`，避免监听普通群聊。

## 3. 用户交互

至少支持以下自然语言意图，不要求固定标点或完整命令：

- `@Tower 授权本群`
- `@Tower 授权本群并绑定 Tower 工作区`
- `@Tower 绑定工作区 南招`
- `@Tower 绑定项目 南招前端`
- `@Tower 绑定项目 南招前端、南招后端`
- `@Tower 解除本群绑定`
- `@Tower 查看本群权限`
- `@Tower 撤销本群授权`

行为要求：

- `gateway`、`platform`、`chatId`、`senderId` 从当前 inbound 上下文取得，用户不输入 ID。
- 工作区/项目允许按 ID、名称或 alias 解析。
- 0 个匹配时不写入；返回可操作的错误。
- 多个匹配时不猜测、不写入；返回候选项，等待 OWNER 选择。
- 授权、绑定、解绑、撤销必须由 OWNER 专用工具执行；LLM 只做意图提取和结果表达，不能直接改配置文件或数据库。
- 成功回复必须展示最终状态和 NON_OWNER 的实际可读范围。
- `ALL` 授权时必须明确提示：“本群成员现在可以只读查询 Tower 中的所有工作区和项目”。

## 4. 权威数据模型

不要继续把动态状态分散保存到 `harness.gatewayConfig.accessPolicy.trustedChannels`、OpenClaw JSON 和 `harness.channelBindings`。新增结构化、可事务更新的权威表；OpenClaw 配置只是其运行时投影。

建议 Prisma 模型（命名可按仓库惯例微调）：

```prisma
enum GatewayChannelAuthorizationStatus {
  AUTHORIZED
  REVOKED
}

enum GatewayChannelScopeMode {
  ALL
  WORKSPACE
  PROJECTS
}

model GatewayChannelAuthorization {
  id           String   @id @default(cuid())
  gateway      String
  platform     String
  chatId       String
  status       GatewayChannelAuthorizationStatus
  scopeMode    GatewayChannelScopeMode
  workspaceId  String?
  authorizedBy String
  authorizedAt DateTime
  revokedBy    String?
  revokedAt    DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  projects GatewayChannelProjectScope[]

  @@unique([gateway, platform, chatId])
  @@index([platform, chatId, status])
}

model GatewayChannelProjectScope {
  authorizationId String
  projectId       String

  authorization GatewayChannelAuthorization @relation(fields: [authorizationId], references: [id], onDelete: Cascade)

  @@id([authorizationId, projectId])
  @@index([projectId])
}
```

约束：

- 所有 gateway/platform/chat ID 写入前使用现有 normalization 规则。
- `ALL`：`workspaceId = null` 且无 project scope。
- `WORKSPACE`：必须存在唯一 workspace，`workspaceId != null` 且无 project scope。
- `PROJECTS`：至少一个有效 project scope；项目可以跨工作区，因为用户明确选择的是项目集合。
- 删除被绑定的工作区/项目时必须 fail closed，绝不能自动扩大为 `ALL`。可选择撤销该群授权，或保留 `WORKSPACE/PROJECTS` 且返回“绑定已失效，需要 OWNER 重新绑定”。
- 授权、范围替换和审计字段更新在一个事务内完成。

若 Prisma migration 代价过高，可先用一个版本化 JSON SystemConfig 做 MVP，但必须提供并发安全的单一写入口和显式 `scopeMode`；禁止用“字段为空”同时表达 `ALL` 与无效绑定。

## 5. MCP / Gateway 工具契约

新增一个 OWNER-only 工具，建议名：`manage_gateway_channel_access`。

```ts
{
  action: "authorize" | "bind_workspace" | "bind_projects" | "unbind" | "revoke" | "get",
  gatewayInboundId: string,
  workspace?: string,
  projects?: string[]
}
```

要求：

- 优先只接受 `gatewayInboundId` 来定位当前 gateway/platform/chat/sender，不让调用方提交任意 `chatId` 或 `senderId`。
- Tower 从持久化的 `GatewayInbound` 读取真实上下文，并再次确认 sender 是该平台 OWNER。
- `get` 可以暴露给 OWNER；NON_OWNER 如需查看可返回不敏感的当前群范围摘要，但不能列出其他群。
- 所有 mutation 均要求 OWNER；非 OWNER 调用必须服务端拒绝，不能只靠 prompt。
- mutation 结果返回版本/更新时间，便于运行时投影幂等刷新。
- 工具加入 OWNER profile capability 列表和 `src/mcp/tool-capabilities.ts`；不得加入 NON_OWNER 直接工具列表。

如果当前 OpenClaw 入站尚不能在调用工具前得到 `gatewayInboundId`，先增加一个不产生业务副作用的入站登记步骤。不得把模型传入的昵称或消息正文当作身份凭证。

## 6. 入站访问决策

新增单一策略函数，所有 Gateway query、项目知识查询、任务/终端状态查询都必须复用，禁止各工具各自解释授权状态。

建议输出：

```ts
type GatewayChannelDecision =
  | { role: "OWNER"; allowed: true; scope: { mode: "ALL" } }
  | { role: "NON_OWNER"; allowed: false; reason: "CHANNEL_UNAUTHORIZED" | "CHANNEL_REVOKED" | "SCOPE_INVALID" }
  | { role: "NON_OWNER"; allowed: true; scope: { mode: "ALL" } }
  | { role: "NON_OWNER"; allowed: true; scope: { mode: "WORKSPACE"; workspaceId: string } }
  | { role: "NON_OWNER"; allowed: true; scope: { mode: "PROJECTS"; projectIds: string[] } };
```

执行顺序：

1. 用 verified sender ID 判断 OWNER；命中后直接返回 OWNER + ALL，不读取群授权来削弱 OWNER。
2. NON_OWNER 查询当前群授权记录。
3. 无记录、`REVOKED` 或失效 scope：拒绝。
4. `AUTHORIZED + ALL`：允许所有 Tower 只读查询。
5. `AUTHORIZED + WORKSPACE/PROJECTS`：为现有查询强制追加范围过滤。

NON_OWNER 永远不能获得 Tower 写操作、任务创建/修改、终端输入、继续任务、外部 Operator 或 OWNER capability。不能依赖模型“自觉不调用”；工具发现/调用层必须限制。

## 7. OpenClaw 飞书入口策略

现状 `groupPolicy = allowlist` 会在 Tower 看到消息前丢弃陌生群，因此无法动态授权。安装器需要生成支持动态授权的策略。

目标配置语义：

- `groupPolicy: "open"`
- `requireMention: true`
- 所有被 `@` 的群消息可以进入 o-tower，但权限决策必须在读取 Tower 数据或执行工具之前完成。
- OWNER sender 使用现有 OWNER tool policy。
- NON_OWNER sender 只能使用经过上述范围决策的 gateway-query 工具，不能直接获得 `list_*`、`ask_project_knowledge` 等可绕过范围的工具。

未授权群 NON_OWNER 的拒绝回复必须是确定性结果：

> 本群尚未获得 Tower OWNER 授权，暂时无法使用。请联系 OWNER 在本群发送“@Tower 授权本群”或直接绑定工作区/项目。

拒绝要求：

- 权限判断在 Tower 服务端完成，不由 LLM 猜测。
- 同一群的拒绝提示限频（建议 60 秒一次），避免刷屏；被限频的请求静默丢弃。
- 拒绝路径不加载项目知识、不创建 Gateway work、不调用 Operator。

不得直接修改 `node_modules/@openclaw/feishu`。若 OpenClaw profile 层无法在 LLM 前实现拒绝，可让最小 profile 回合调用只读 access-decision 工具后输出固定文案，但数据工具必须保持不可见；同时在实现说明中记录该限制。

## 8. OpenClaw 配置投影

`src/lib/extensions/tower-agent-install.ts` 当前会从静态 `trustedChannels/channelScopes` 重建 `channels.<platform>.groups` 和 bindings。改造后：

- 安装/更新不再删除动态群授权。
- 静态可信群迁移成 `AUTHORIZED` 记录。
- 有 channel scope 的群迁移为 `WORKSPACE`；只有 trusted channel 的群迁移为 `ALL`。
- 动态授权记录是权威，OpenClaw `groups`/bindings 是可重建投影。
- 写 OpenClaw JSON 必须沿用现有 backup + 原子替换机制。
- 投影失败时数据库授权状态保留并返回明确错误；不得谎报授权成功。
- 如 OpenClaw 支持配置热加载则验证后使用；否则给出“授权已保存，Gateway 重载后生效”，不要擅自重启用户进程。

`harness.destinations` 是出站别名，不代表入站授权，继续与本功能分离。

## 9. UI

设置页保留 OWNER ID 配置。把“可信群 / 会话”和“群工作区范围”的文本框改为只读管理列表或兼容入口：

- 显示平台、群 ID（可截断）、授权状态、范围、授权人、更新时间。
- 支持 OWNER 在 UI 撤销、重新授权、改绑；UI 不是主要入口。
- 旧文本配置首次迁移后提示已转换，避免双写。
- 私服飞书无法展示群名时允许只显示截断 chat ID；群内操作不依赖群名。

实现任何 Next.js UI 前，按仓库 `AGENTS.md` 要求先读取 `node_modules/next/dist/docs/` 中相关版本文档。

## 10. 迁移与兼容

一次性幂等迁移顺序：

1. 读取各 gateway 的 `accessPolicy.trustedChannels`。
2. 对同时存在 `channelScopes` 的群创建 `AUTHORIZED + WORKSPACE`。
3. 对只有 trusted channel 的群创建 `AUTHORIZED + ALL`。
4. 保留 OWNER IDs。
5. 不把 `harness.destinations` 自动视为授权。
6. 成功写入并验证新记录后，再停止旧字段参与权限判断；可暂留旧字段供回滚读取。
7. 重复执行不得覆盖更新后的动态授权或产生重复记录。

当前“起飞群”应迁移为已授权且绑定 Tower 工作区；其他仅存在于 destinations 的群仍保持未授权。

## 11. 建议修改范围

实现者先搜索实际调用链，以下是主要落点而非强制逐文件清单：

- `prisma/schema.prisma` 与新 migration
- `src/lib/harness/gateway-router.ts`
- `src/lib/harness/gateway-config.ts`
- `src/lib/extensions/tower-agent-install.ts`
- `src/mcp/tools/harness/` 下 OWNER 管理工具与 shared policy
- `src/mcp/tool-capabilities.ts`
- `extensions/tower-agent/agent/AGENTS.md`
- `extensions/tower-agent/agent/TOOLS.md`
- `skills/tower/SKILL.md` 或其网关授权参考
- `src/components/settings/gateway-extension-settings.tsx`
- 中英文 i18n 与模块文档

保留工作区当前所有无关修改，不得重置、覆盖或顺手格式化用户已有改动。

## 12. 必测场景

### 权限

1. OWNER 在从未配置的群中可以查询、授权和绑定。
2. 未授权群 NON_OWNER 得到固定拒绝，且不触发项目读取。
3. 已授权 `ALL` 群中 NON_OWNER 可跨工作区只读查询。
4. 绑定 workspace 后，NON_OWNER 无法查询其他 workspace。
5. 绑定 projects 后，NON_OWNER 无法查询列表外项目。
6. OWNER 在绑定群中仍可访问全部范围及 OWNER 工具。
7. NON_OWNER 伪造“我是 OWNER”文本无效。
8. NON_OWNER 不能直接调用管理工具、写工具、终端或 Operator。
9. 撤销后立即拒绝 NON_OWNER；OWNER 可重新授权。
10. 解除绑定后回到 `ALL`。

### 一致性与故障

11. 名称不存在或歧义时不写入。
12. migration 重复执行幂等。
13. OpenClaw 配置投影失败不丢数据库授权，也不返回成功。
14. 删除被绑定资源不会扩大为 `ALL`。
15. 并发授权/撤销结果可线性化，最终状态与回复一致。
16. 重复平台消息通过现有 inbound 幂等键只执行一次 mutation。
17. 未授权拒绝限频生效。

### 回归

18. OWNER 私聊继续正常。
19. 现有起飞群在迁移后行为不变。
20. Harness 出站 destinations、无人值守 OWNER home route 不受影响。
21. Gateway task reply/continue 的原有绑定和幂等逻辑不受影响。

## 13. 验收标准

完成必须同时满足：

- 新群只需拉入机器人，OWNER 无需查看或复制任何 ID。
- OWNER 在新群发送 `@Tower 授权本群` 后，其他成员可立即进行所有项目的只读查询。
- OWNER 发送绑定命令后，其他成员越权查询被服务端拒绝。
- OWNER 撤销后，其他成员立即不可用。
- 陌生群 NON_OWNER 不获得任何 Tower 数据或写能力，并收到限频的未授权提示。
- 所有授权 mutation 有持久记录和自动化测试。
- OpenClaw/Tower 重启后授权状态仍正确。
- 旧配置安全迁移，起飞群、OWNER 私聊和出站通知无回归。

## 14. 非目标

- 不以“OWNER 当前是否仍是群成员”作为持续授权条件；成员列表权限和变更事件在私服飞书中不可靠。
- 不根据群名自动绑定项目。
- 不让普通成员申请或提升权限。
- 不让授权自动过期；后续可单独设计有效期。
- 不把群授权扩展为外部 SaaS、电脑或 R2/R3 capability 授权。
