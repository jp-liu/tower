---
title: Tower Agent 能力扩展
description: 如何通过专用 operator agent 扩展 o-tower 的飞书、邮件、知识库等外部系统能力
---

**Slug:** `agent-extension`

## 设计原则

`o-tower` 是 Tower 的入口和协调者，不是万能执行者。

Tower 官方默认 profile 保持纯净：只安装 Tower MCP 和 `tower` skill，负责项目、任务、笔记、无人值守消息登记与回灌。飞书、邮件、Slack、Notion、企业知识库等第三方能力由用户或团队在本地网关中配置专用 operator agent，再让 `o-tower` 按能力路由委托。

推荐分工：

| 角色 | 直接能力 | 职责 |
|------|----------|------|
| `o-tower` | Tower MCP + `tower` skill | 接收入口消息、判断意图、创建/更新 Tower 任务、把外部系统请求委托出去、汇总结果 |
| `xiao-fei` 等 operator | 飞书或其他外部系统 MCP/skills | 执行用户有权访问的公司文档空间操作，例如文档页面、知识库页面、普通表格、多维表格、云盘文件、附件、权限检查 |
| Tower | 任务与协作状态 | 记录需求、进展、问题、回复，不持有第三方系统密钥 |

这个边界让 Tower 的默认安装对所有用户都可用，也避免把某个团队的飞书、邮件或知识库配置塞进全局 `o-tower` 本体。

## OpenClaw + 飞书安装与更新

Tower Agent 依赖 OpenClaw 已经能正常接收飞书消息。飞书应用、机器人、权限和凭据由 OpenClaw 管理；Tower 的扩展安装器不会代为安装飞书渠道。开始前先在目标群聊或私聊中确认 OpenClaw 能回答一条普通消息，并确认这些会话中发给机器人的消息会路由到 Tower 将安装的 profile（默认 `o-tower`）。这项渠道绑定应在 OpenClaw 中配置。

### 1. 构建并启动 Tower

使用 npm 公共包时：

```bash
npm install -g @tower-org/cli@latest
tower
```

从源码部署时，先停止旧 Tower 进程，再执行：

```bash
pnpm install
pnpm build
pnpm start
```

后续步骤期间保持新 Tower 进程运行。Tower 启动时会执行数据库迁移，并恢复持久化的网关工作请求和待发送消息。

### 2. 安装或重新注入 Tower Agent

1. 打开 **Tower -> 设置 -> 扩展 -> Tower 网关 Agent 设置**。
2. 在 **Tower Agent (OpenClaw)** 中保留默认 profile `o-tower`，或填写飞书渠道实际使用的 profile。
3. 只填写本机确实需要的网关运行时环境变量；Tower 不预设代理或 `NO_PROXY` 规则。
4. 首次安装点 **安装**；Tower 升级、profile 文件或 skill 有变化时点 **更新**。

“更新”就是重新注入流程。它会用当前 Tower 包内的版本刷新 `SOUL.md`、`AGENTS.md`、`TOOLS.md`、Tower MCP 配置和 `tower` skill，同时保留 OpenClaw agent 条目中不归 Tower 管理的其他字段。

### OWNER 与动态群授权

设置页只维护 **OWNER IDs**（每行 `platform:senderId`）。OpenClaw 在同一个
`o-tower` profile 内按真实 sender 切换 Tool Surface：OWNER 获得管理工具，
NON_OWNER 只能调用受控查询入口。群入口采用 `groupPolicy=open`，但仍要求真实
@；这只是让新群可以进入授权判断，不代表新群已经获得 Tower 数据权限。

OWNER 在群内发送“授权本群”“绑定工作区/项目”“解除绑定”或“撤销授权”。动态
状态保存在版本化扩展配置 `tower-agent.channel-access.v1` 中，范围显式为 `ALL`、
`WORKSPACE` 或 `PROJECTS`。Tower 在每次项目读取和回复完成前重新校验，撤销、
缺失或失效绑定一律 fail closed。设置页以“群名 + 群 ID + 实际范围”展示记录；
群名仅供显示，不参与身份判断。

旧 Trusted Channels / channelScopes 只做一次幂等迁移，之后不再参与运行时权限
判断。完整设计、验收与排障见
`docs/design/o-tower-personal-assistant-security-and-operations.md`。

### 3. 重启网关并刷新飞书会话

严格按下面顺序执行：

```bash
openclaw gateway restart
openclaw gateway status
openclaw status --all
```

随后在**每个受影响的飞书群聊或私聊中**单独发送一条：

```text
/new
```

`/new` 必须是一条独立消息。它让该 OpenClaw 会话重新加载刚注入的 profile 和 skills；应在 gateway 重启后执行，并对每个待验收会话分别执行。它不会删除或关闭 Tower 中已持久化的队列、项目讨论历史和绑定，也不会刷新 Tower 内已经运行很久的 Workbench 终端。

完整顺序是：**更新并启动 Tower -> 更新/重新注入 Tower Agent -> 重启 OpenClaw gateway -> 在受影响飞书会话发送 `/new` -> 开始验收**。

## OpenClaw 首跳与三类 Tower 路由

OpenClaw 先做能力边界判断。普通问答和第三方 operator 工作留在 OpenClaw，不调用 Tower，也不创建 `GatewayInbound`。只有 Tower 查询/操作、项目讨论和项目工作调用 `route_gateway_message`。旧客户端若仍传 `DIRECT`，Tower 返回 `direct_not_supported`，且不落库。

| 路由 | 职责边界 | 进入 Workbench | 创建用户任务 | 回复链路与持久化 |
|------|----------|----------------|--------------|------------------|
| `TOWER` | 在网关内调用 Tower MCP 做查询或简单操作 | 否 | 路由本身不创建；只有用户明确要求且 MCP 成功时才可能创建 | 网关直接回复；任何写操作只能在工具成功后确认。 |
| `PROJECT_DISCUSSION` | 由项目常驻 Workbench 基于仓库上下文讨论 | 是，通过 `GATEWAY_DISCUSSION_REQUEST` | **否，不创建 WorkItem 或子任务** | Workbench 调用 `complete_gateway_discussion` 回复当前入站消息。 |
| `PROJECT_WORK` | 把工程工作交给项目常驻 Workbench 调研、下发、审查 | 是，只经持久化事件队列 | Workbench 成功调用 `create_task` 后才创建 | Tower 先发原生“已排队”卡片；随后发真实数据创建卡片；审查通过后发最终结果卡片。 |

项目讨论和项目工作必须严格分开：

- 项目讨论持久化 `GATEWAY_DISCUSSION_REQUEST` 并进入项目 Workbench，但不创建 `WorkItem` 或子任务。
- 只有后续明确的“创建任务/开始工作”请求才持久化 `GATEWAY_WORK_REQUEST`，由同一 Workbench 创建并监督子任务。
- PTY 写入只把持久批次标成 `DISPATCHED`；Workbench 必须调用 `ack_workbench_batch` 后事件才算 `CONSUMED`，处理或稳定委派后再调用 `resolve_workbench_batch`。120 秒没有 ACK 会自动重排。
- 项目常驻 Workbench 是内部协调基础设施，不等于用户请求创建的任务。
- `PROJECT_WORK` 返回 `queued: true` 只表示入站消息和 Workbench 事件已经持久化，**不表示任务已经创建**。
- 只有 Workbench 的 `create_task` 返回真实 task id 后，`confirm_gateway_task_created` 才能发出创建确认。
- 子任务完成后先进入 `IN_REVIEW`；Workbench 审查通过后直接调用 `complete_gateway_work`。该调用会原子地转为 `DONE` 并创建最终回执 outbox，不要提前调用 `move_task(DONE)`。

项目解析会优先使用回复绑定、现有线程绑定和用户明确提供的项目 id/名称/别名。仍有多个候选时必须让用户选择，不能擅自挑最高分项目。无显式线程的连续讨论按“群聊 + 发送者 + 会话类型”复用，最近项目回退七天后失效；显式线程绑定不使用这项过期回退。

项目讨论复用项目常驻 Workbench 上下文。创建任务不会另建一个讨论 Assistant 会话；Workbench 根据后续事件类型区分“直接回答”和“创建子任务”。

回复旧任务卡片时，先调用 `resolve_gateway_task_context` 只读解析任务、项目、状态、OPEN ask 和最近执行摘要。随后按意图选择动作：OPEN ask 用 `reply_to_ask`；状态/结果问题只读查询；外部系统工作带 `towerContext` 委托，不修改 Tower；只有明确“继续/修复/重跑”才调用 OWNER-only `continue_bound_task`。普通解析不会恢复终端。只有用户明确说“创建新任务”或“开始新工作”时才传 `startNewWork=true`，覆盖旧任务回复绑定。

## 飞书真实渠道验收

先选择 Tower 中确实存在且机器人可访问的项目名称或别名。每一步都等待当前回复完成后再进行下一步。

### 1. 普通问答（Tower 外）

发送：

```text
请用一句话解释什么是幂等。
```

预期：飞书中直接得到普通回答；不调用 `route_gateway_message`，不创建 `GatewayInbound`，不启动项目 Workbench，不创建任务。

### 2. Tower 只读查询 (`TOWER`)

发送：

```text
查询 Tower 中 <项目名> 当前进行中的任务，只读，不要创建任务。
```

预期：回答来自 Tower 实际数据；不启动项目 Workbench，不创建新任务。若项目不明确，应返回候选项而不是猜测。

### 3. 项目讨论及同线程续聊 (`PROJECT_DISCUSSION`)

发送：

```text
讨论 <项目名>：当前网关方案最大的风险是什么？不要创建任务。
```

预期：回答由该项目常驻 Workbench 产生；有一个讨论队列事件，但没有 WorkItem 或子任务。

随后在同一飞书线程回复：

```text
继续上一条，按优先级列出两个风险。
```

预期：复用同一个项目绑定讨论会话和上下文，回复仍回到原线程。已确认的真实渠道行为是 Tower 查询和这种项目讨论会话复用可正常工作。

### 4. 项目工作 (`PROJECT_WORK`)

发送：

```text
在 <项目名> 中处理一项工作：补充网关验收文档。
```

按时间顺序验收三种不同结果：

1. 首次收到“⏳ 小塔 · 请求已进入工作台”卡片，只表示请求进入 `<项目名>` Workbench，不能出现“任务已创建”的承诺。
2. Workbench 实际调用 `create_task` 成功后，飞书收到“🚀 小塔 · 任务已创建”卡片。卡片以两列字段展示状态、优先级、项目、工作区、执行方式和分支，目标单独成节；此时才能在 Tower 核对任务。
3. 子任务完成且经 Workbench 审查接受后，飞书收到“✅ 小塔 · 任务已完成”卡片。验收结果与 commit/branch 元数据分区展示，并使用同一个 Tower task id。

如果只收到“已排队”，验收状态仍是等待创建，不能判定任务创建成功。

## 可靠投递与幂等

Tower 会先持久化“已排队”、项目讨论回复、真实任务创建确认和最终结果的文本回退与原生卡片 payload，再通过 OpenClaw 回复当前入站 `platformMessageId` 并保留 `threadId`。这四类 `GatewayDelivery` 都有稳定的语义去重键：

- 发送失败后保留为 `FAILED` 并按退避时间重试；
- Tower 启动时恢复过期的 `SENDING` claim，并重试到期消息；
- 已成功发送的语义消息不可变，重复调用不会发送两次；
- 重复的平台 callback 复用同一入站记录、Workbench 事件和 delivery，不会重复执行动作。

普通问答不进入 Tower；`TOWER` 网关回复也不等同于上述持久化 delivery。当前实现没有完整的 Tower-owned 项目讨论历史 UI；不要把通知中心描述成所有网关会话的完整审计记录。

## 故障排查

### 已排队但迟迟没有真实任务确认

1. 不要重发同一工作请求。用户手工重发会产生新的飞书 message id，可能被视为第二项工作；只有同一 callback 的重试会被幂等去重。
2. 确认新 Tower 进程仍在运行，并检查启动/运行日志中的 `Gateway recovery`、`Workbench` 或 gateway delivery 错误。
3. 打开 Tower **Missions** 或对应项目 Workbench，确认常驻 Workbench 终端是否运行。忙碌终端不会被直接写入；持久化事件要等当前 turn 完成后的安全边界。
4. Tower 重启恢复会自动启动或 Continue Workbench，并为新 PTY 恢复一次安全消费边界；不应再要求手工 Stop/Continue。若仍然 `PENDING`，检查恢复日志，不要重建请求。
5. `/new` 只刷新 OpenClaw 的飞书会话，既不关闭 Tower 讨论，也不能代替 Workbench 恢复。

### Tower 服务重启后的队列恢复

Tower 启动会扫描 `QUEUED`/`PROCESSING` 的项目工作，确保对应 Workbench 启动，恢复安全消费边界，并重试待发送或失败的 delivery。重启后先观察恢复日志和原飞书线程，不要立即重复发送请求。持久化事件和去重键用于恢复原请求，而不是生成一个新请求。

### Profile 或 skill 仍是旧版本

依次执行：扩展页点击 **更新**、`openclaw gateway restart`、在受影响飞书会话单独发送 `/new`。只重启 Tower 不会刷新 OpenClaw 活跃会话；只发 `/new` 也不会更新磁盘文件或 Tower Workbench hooks。

### 查看 Tower 与 OpenClaw 状态

```bash
openclaw gateway status
openclaw status --all
```

- Tower **设置 -> 扩展**：查看 Tower Agent (OpenClaw) 是否已安装及其版本。
- Tower **Missions** 或项目 Workbench：查看常驻 Workbench 执行与终端状态。
- Tower 看板/任务详情：用创建确认中的 task id 核对真实任务，而不是用“已排队”回复推断。
- Tower 前台或服务日志：查看启动恢复、队列消费和投递失败。
- Tower 通知中心：适合查看任务提问和通知，但不是项目讨论、入站路由、delivery 的完整历史页面。

## 当前限制

- Tower Agent 默认只安装 Tower 能力，不安装飞书 MCP、凭据或第三方 operator。
- 项目讨论历史已由 Tower 持久化，但目前没有完整的 discussion history UI。
- 原生卡片依赖 OpenClaw `--presentation` 支持；旧版 OpenClaw 会降级为持久化的文本回退。
- 共享群聊的入口由 Trusted Channels 限制，项目范围可继续用
  `harness.channelBindings` 收窄；目前后者没有专门的可视化管理页面。
- `REVIEW_ONLY` 是 Workbench 工作流约束，不是操作系统沙箱；不可信仓库执行
  仍需容器/虚拟机/只读挂载。

## 能力路由

把能力当成可路由的命名空间，而不是把所有工具装给同一个 agent。

示例：

```yaml
capabilityRoutes:
  tower.task: o-tower
  tower.project: o-tower
  tower.note: o-tower
  feishu.docs: xiao-fei
  feishu.wiki: xiao-fei
  feishu.sheets: xiao-fei
  feishu.bitable: xiao-fei
  feishu.drive: xiao-fei
  feishu.permissions: xiao-fei
  mail.read: mail-operator
  mail.send: mail-operator
```

`o-tower` 看到 Tower 范围内的需求时自己处理；看到飞书文档页面、知识库页面、普通表格、多维表格、云盘文件、附件、权限等请求时，把目标、输入、期望输出和风险约束交给 `xiao-fei`。`xiao-fei` 返回结构化结果后，`o-tower` 再回复用户或写回 Tower。

## 统一 tower-bridge

所有需要 Gateway 持有渠道、凭据、用户会话、能力路由或 Operator 的外部操作都使用
`tower-bridge`。任务终端中的 Shell、文件、Git、依赖、构建、测试和本地数据库操作
仍直接在终端执行；联网或需要人工确认本身并不会把一个终端命令变成 bridge 操作。
真人或群组消息是
`human.message.send`：用户明确指定收件人时走 `explicit` 模式和
`push_to_human`；无人值守主动联系 OWNER 时走 `owner_home` 模式、固定
OWNER 路由和 bounded grant。原 `tower-ask` 已合并，不再作为独立 skill 安装。

当前 CapabilityRequest 合约仅允许 `human.message.send / DIRECT / R2`。
飞书文档、表格、浏览器或电脑等其他已公布能力使用其 discovery 返回的 `JOB` 路径。

当一个 Tower 任务需要“把整理结果交给小塔，让小塔按扩展能力分流”时，也使用 `tower-bridge`：

```text
当前任务
-> tower-bridge
-> o-tower 网关 / Tower 任务终端
-> 按本地路由委托给 xiao-fei 等 operator
-> 汇总结果回当前任务或用户
```

`tower-bridge` 是统一外部能力技能，不安装第三方 MCP，也不默认持有飞书、邮件、知识库等权限。它只负责把结构化请求交给正确的渠道或执行 owner。

## OpenClaw 示例：小飞负责飞书

先创建专用 agent workspace：

```bash
openclaw agents add xiao-fei \
  --workspace ~/.openclaw/workspaces/xiao-fei \
  --agent-dir ~/.openclaw/agents/xiao-fei/agent \
  --non-interactive
openclaw agents set-identity --agent xiao-fei --name 小飞
```

安装和配置飞书 MCP/skills 时只给 `xiao-fei` 使用。`o-tower` 保持 Tower-only。这里的小飞不是表格专员，而是飞书工作空间 operator：它负责你有权限访问的公司文档、知识库页面、普通表格、多维表格、云盘文件、附件和权限检查。

`~/.openclaw/openclaw.json` 中收窄 allowlist：

```json
{
  "agents": {
    "list": [
      {
        "id": "o-tower",
        "skills": ["tower"],
        "allowedTools": ["tower__*"]
      },
      {
        "id": "xiao-fei",
        "skills": ["feishu"],
        "allowedTools": ["feishu__*"]
      }
    ]
  }
}
```

如果使用本地统一 Feishu MCP facade，可以把官方 Lark MCP 与普通 Sheets values 工具合并到一个 `feishu` MCP server，对外暴露同一 `feishu__...` namespace。例如普通飞书表格补充工具可命名为：

- `feishu__auth_login_start`
- `feishu__auth_login_command`
- `feishu__sheets_workbook_create`
- `feishu__sheets_spreadsheet_create`
- `feishu__sheets_sheet_add`
- `feishu__sheets_sheet_delete`
- `feishu__sheets_values_resolve`
- `feishu__sheets_values_read`
- `feishu__sheets_values_update`
- `feishu__sheets_values_append`

## 路由文件

在 `o-tower` workspace 放一份本地路由表，例如：

```text
~/.openclaw/workspaces/o-tower/delegation-routes.json
```

可参考 Tower 扩展包内的：

```text
extensions/tower-agent/examples/openclaw-local-delegation-routes.json
```

最小示例：

```json
{
  "schemaVersion": 1,
  "sourceAgent": "o-tower",
  "defaultPolicy": {
    "directCapabilities": ["tower"],
    "delegateExternalCapabilities": true,
    "noDefaultThirdPartyIntegration": true
  },
  "routes": [
    {
      "id": "feishu-sheets",
      "capabilities": ["feishu.sheets", "feishu.bitable"],
      "match": ["飞书表格", "飞书多维表格", "Bitable", "Base"],
      "agent": "xiao-fei",
      "delegateCommand": "openclaw agent --agent xiao-fei --json --message-file <task-file>",
      "requiresConfirmationForWrite": true
    },
    {
      "id": "feishu-docs-wiki-drive",
      "capabilities": ["feishu.docs", "feishu.wiki", "feishu.drive", "feishu.permissions"],
      "match": ["飞书文档", "飞书云文档", "飞书知识库", "飞书 wiki", "飞书文件", "飞书附件", "云盘", "文件夹"],
      "agent": "xiao-fei",
      "delegateCommand": "openclaw agent --agent xiao-fei --json --message-file <task-file>",
      "requiresConfirmationForWrite": true
    }
  ]
}
```

然后在 `~/.openclaw/workspaces/o-tower/USER.md` 或 profile rules 中加入委托意识：

```text
你直接操作 Tower。遇到飞书文档页面、知识库页面、普通表格、多维表格、云盘文件、附件、权限请求时，按
delegation-routes.json 委托给 xiao-fei。委托时写清目标、输入链接/表名/range、
期望输出、是否只读、写入风险。写入、删除、批量修改、权限变更默认先给用户确认计划。
面向用户回复时使用“文档页面”“知识库页面”“表格”“多维表格”等业务词，不要暴露 DocX、obj_type、MCP namespace、token、临时文件路径或底层命令。
```

## 委托消息格式

给 operator agent 的任务建议固定为结构化文本，减少来回追问：

```yaml
goal: "读取飞书表格并汇总班级权限规则"
capability: "feishu.sheets"
inputs:
  links:
    - "<用户提供的飞书链接>"
  sheetName: "V2.0分班系统"
  range: "A1:K120"
mode: "read-only"
expectedOutput:
  ok: true
  summary: "面向用户的简短结论"
  evidence: "用表名、字段名、行号描述依据，不泄露 token"
  actionsTaken: []
  risks: []
constraints:
  - "不要输出 app secret、access token、refresh token"
  - "写入或权限变更前必须先返回计划等待确认"
```

## 用户自定义选择

高级用户可以把飞书 MCP/skills 直接装进自己的 `o-tower`，让它直接操作飞书。这是个人环境选择，不是 Tower 官方默认 profile 的推荐路径。

官方默认保持纯净的原因：

- 第三方系统权限属于用户或团队，不应被 Tower 默认安装隐式持有。
- 不同公司对飞书、邮件、知识库的权限、审批和审计要求不同。
- 专用 operator 更容易做最小权限、单一 token owner、审计和替换。
- 多个 MCP 进程同时刷新同一 user token 容易产生竞争，专用 owner 更稳。

## 风险和边界

- 不要在文档、prompt、路由表中写入 app secret、access token、refresh token。
- 飞书文档/表格如果要按“用户能操作，agent 才能操作”的同权方式运行，应走 `user_access_token`，并由一个 MCP owner 管理刷新。
- 本地化飞书 OAuth 登录默认不要手动传 `--scope`；未申请、未发布或未生效的权限可能触发 `20027 AppDidNotApplyForPermissions`。
- 飞书 wiki URL 即使带 `sheet=...`，也必须先解析真实对象类型；真实对象是文档页面时就按文档页面读取，不要硬当表格读。
- 写入、删除、批量修改、权限变更、对外发送邮件/消息等动作默认先返回计划，等用户明确确认。
- 修改 OpenClaw agent/MCP 配置后，重启或 reload gateway。
- Tower 不默认集成飞书给所有用户；Tower 只提供扩展模式和委托规则。
