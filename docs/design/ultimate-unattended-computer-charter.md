# 终极无人值守电脑章程

> 状态：最终版；首个模块化与恢复增量已实现并通过验证
> 定稿日期：2026-08-02
> 配套交付：架构图解、Technical Spec、可编辑多页图源与四张最终导出图

本文记录 Tower、o-tower、OpenClaw 与外部 Operator 在“终极无人值守电脑”目标下的长期边界。
本文只确定系统职责、跨系统契约语义和可靠性原则，不提前决定尚未进入实施阶段的具体 API、数据库
迁移或代码任务。具体实现状态、验证证据和未完成项以架构图解与 Technical Spec 为准。

## 1. 愿景

OWNER 离开电脑后，可以通过消息渠道下达目标。系统能够判断请求属于项目工作、电脑操作、外部
SaaS 操作还是普通问答，把它交给正确的执行系统，并在需要时完成追问、证据回传和后续继续。

最终系统不是一个包办所有事情的单体 Agent，而是由职责清晰的中枢和执行器协作：

- OpenClaw 负责人与系统之间的入口、身份和能力分发；
- Tower 负责围绕项目持续推进、审查和沉淀工作；
- 专用 Operator 负责电脑或外部系统中的具体动作。

## 2. 第一步决议：系统定位

本阶段确认以下核心定义：

> **OpenClaw 是个人工作流中层和电脑能力中枢；Tower 是项目工作中枢。**
>
> 人类请求先由 OpenClaw 完成身份判断和能力分发：项目型长期工作进入 Tower，电脑和外部
> SaaS 操作进入相应 Operator，普通问答留在 OpenClaw。Tower 负责把项目做完，OpenClaw
> 负责把请求送到正确的执行系统。

这里的“电脑能力中枢”表示 OpenClaw 负责发现、授权和分发本机能力，不表示 OpenClaw 自己直接
执行所有 GUI 动作。实际电脑操作仍由具有最小权限和证据协议的 Computer Operator 完成。

## 3. Tower 的边界

Tower 不应被定义为只管理代码。更准确的定义是：

> **Tower 管理以项目上下文为中心、可由 CLI Agent 持续处理、需要状态与审查的工作。**

Tower Project 的物理基础可以只是一个文件夹。文件夹中的内容和仓库内约定决定 Agent 如何工作，
Tower Core 不应把项目硬编码成软件工程仓库。

可进入 Tower 的项目包括但不限于：

- 软件代码仓库；
- 文案、书稿、课程内容或品牌内容仓库；
- 产品需求、设计资料和研究材料；
- 数据分析脚本、输入材料与结果；
- 静态知识库和文档集合；
- 其他能由 CLI Agent 在文件工作区内持续处理的项目。

“可以通过 CLI 使用 AI 完成”只是能力条件，不是所有请求都进入 Tower 的充分条件。适合进入 Tower
的工作还应至少具备一项特征：

- 依赖长期项目上下文；
- 需要拆分为任务或多轮执行；
- 需要保留状态、过程、产物或决策；
- 需要版本管理、审查、验收或失败恢复；
- 预计会被后续工作继续引用。

普通问答、一次性查询和不需要项目状态的简单电脑动作不应为了“统一”而创建 Tower 任务。

## 4. OpenClaw 与 o-tower 的边界

OpenClaw 是 OWNER 的个人工作流入口，负责：

- 接收来自飞书、微信或其他渠道的消息；
- 使用平台真实身份和会话信息做权限判断；
- 判断请求应进入 Tower、Computer Operator、飞书 Operator、其他能力或普通回答；
- 保存消息渠道与会话语境；
- 把执行结果整理后回复到正确的人和会话。

o-tower 是 OpenClaw 中面向 Tower 的对话与路由角色，不是第二个项目管理系统。它可以查询 Tower、
把项目工作送入 Tower，也可以把 Tower 之外的能力委托给本地 Operator，但不拥有 Tower 的项目事实。

OpenClaw 不应复制 Tower 的任务状态、项目知识和执行历史作为第二套业务真相。

## 5. Operator 的边界

Operator 是受限执行器，不是新的工作流中枢：

| Operator | 负责 | 不负责 |
|---|---|---|
| Computer Operator | 有边界的桌面、浏览器和 GUI 操作；返回观察结果与证据 | 决定业务目标、管理 Tower、直接联系用户 |
| Feishu Operator | 文档、表格、知识库、云盘和权限等飞书操作 | 管理项目任务、代替 o-tower 持有会话 |
| 后续 Operator | 自己领域内经过授权的具体动作 | 扩张为通用项目编排器 |

Operator 的可替换性是边界是否正确的重要检验：替换 Computer Operator 或飞书 Operator 时，不应要求
修改 Tower 的项目模型和核心任务协议。

## 6. 基本调用方向

本阶段只确认调用方向，不定义传输协议。

### 6.1 外部消息入口

```text
人类 -> OpenClaw / o-tower -> Tower | Computer Operator | Feishu Operator | 普通回答
```

### 6.2 开发者直接入口

开发者在电脑前可以直接通过 Tower UI、MCP 或任务终端管理项目，不必强制经过 OpenClaw。

```text
开发者 -> Tower -> Workbench / CLI Agent
```

### 6.3 Tower 的外部能力请求

Tower 在项目执行过程中需要操作电脑、外部 SaaS 或联系 OWNER 时，可以反向请求 OpenClaw 的能力层。
这是能力调用，不改变数据归属：Tower 仍拥有项目任务，OpenClaw 仍拥有渠道和外部能力路由。

```text
Tower task -> tower-bridge -> OpenClaw capability routing -> Operator / human channel
```

## 7. 路由权威

为避免 Tower 与 OpenClaw 各维护一套路由，确认以下原则：

- Tower 只判断请求是否属于 Tower 内部任务、另一个 Tower 任务、人类消息或外部能力；
- `tower-bridge` 是 Tower 发出外部能力请求的端口，不是第二个外部 Agent 路由中心；
- Tower 可以表达需要的 capability 和执行约束，但不保存 `computer.gui -> operator`、
  `feishu.bitable -> xiao-fei` 等本机 Agent 映射；
- 外部 capability 到具体 Agent、传输方式和本机配置的映射由 OpenClaw 侧唯一拥有；
- 用户明确指定某个 Operator 时，Tower 可以传递 target hint，但最终仍由 OpenClaw 的权限和路由策略确认。

因此，Tower 内不应长期保留小飞、Computer Operator、OpenClaw workspace 路径或具体委托命令等本机
实现知识。首个实施增量已从 `tower-bridge` 删除具体 Agent 映射，改为结构化 capability 契约；真正的
capability 到本机 Agent 映射继续只归 OpenClaw 配置所有。

## 8. 第二步决议：单一能力中心与外部能力契约边界

外部能力只在 OpenClaw 维护一套，但这不表示 Tower 的每次外部能力请求都必须经过 o-tower Agent
重新理解。为避免重复读取项目上下文和额外模型调用，确认以下逻辑分层：

| OpenClaw 内部角色 | 职责 |
|---|---|
| o-tower | 理解外部人类消息、持有对话语境、选择项目工作或外部能力 |
| 能力目录与路由权威（逻辑上记作 Capability Registry） | 唯一保存 capability 到 adapter / Operator 的本机映射和授权配置 |
| 外部能力契约边界（逻辑上记作 Capability Port） | 接收结构化能力请求，校验并按 Registry 分发；自身不做 LLM 推理 |
| Transport / Adapter | 执行确定性的消息发送或结构化外部 API 操作 |
| Operator | 对确实需要理解、规划或 GUI 操作的复杂请求执行受限 Agent 工作 |

Capability Registry 表示 OpenClaw 内部唯一的能力目录和路由权威，可以由现有配置、工具元数据或
运行时能力组合提供，不预设独立 Registry 服务或数据库。Capability Port 只表示调用方与 OpenClaw
能力中心之间的**语义和契约边界**，也不是本章程预先批准的新中间件、服务或部署单元。Technical
Spec 必须按以下顺序验证实现：

1. 优先复用 OpenClaw 已有的非 LLM tool、task、run、status 或等价原生能力；
2. 原生能力只缺少稳定契约时，在其上增加薄适配层；
3. 只有前两者经验证仍无法满足契约时，才新增最小插件工具或本地 RPC。

不得在未核验 OpenClaw 原生能力前先造第二套 Gateway、Job 系统或通用中间件。具体传输、进程边界和
部署形式留到 Technical Spec 决定。

Capability Port 命名的是一组职责——请求校验、按 Registry 分发、执行车道选择、结果归一化与只读对账——
这些职责可分散由 OpenClaw 现有工具入口承担，不要求单一调用点或单一进程。架构图中若出现 Capability
Port，必须以逻辑契约边界（虚线）表示，不画成实体组件框，以免被实现成“第二个 Gateway”。

### 8.1 两个调用入口，共用一个能力中心

外部人类请求由 o-tower 理解后调用 Capability Port：

```text
人类 -> o-tower -> OpenClaw Capability Port -> Adapter / Operator
```

Tower CLI Agent 已经理解项目上下文并形成明确外部动作时，直接提交结构化能力请求，不再经过
o-tower 做第二次自然语言推理：

```text
Tower CLI Agent -> tower-bridge -> OpenClaw Capability Port -> Adapter / Operator
```

这两个入口共享同一份 Capability Registry、凭据、权限和本机 Operator 配置，因此不会形成 Tower 与
OpenClaw 两套飞书或电脑能力。

### 8.2 按操作复杂度选择执行层

| 操作类型 | 目标执行层 | 是否需要额外 Agent |
|---|---|---:|
| 发送已经生成好的消息 | Gateway transport / channel adapter | 否 |
| 无人值守追问或通知 | Gateway transport，并记录必要任务关联 | 否 |
| 参数明确的结构化外部读写 | 对应 capability adapter | 原则上不需要 |
| 需要理解、整理和多步处理的外部工作 | 专用 Operator | 是 |
| 桌面、浏览器和 GUI 操作 | Computer Operator | 是 |

简单发送不应为了统一入口而启动 o-tower 或 Feishu Operator。统一维护的是 capability、凭据、权限和
路由，不是强制每个动作经过同一种执行器。

表中 Gateway transport / channel adapter 是 Capability Port 背后的执行层，不是绕过 Port 的旁路：消息发送
仍经 Port 的授权校验与 `requestId` 去重，只是不额外启动理解型 Agent。

### 8.3 最小上下文原则

Tower 已经读取的项目上下文不应整体转发给 OpenClaw 或 Operator。`tower-bridge` 只提交完成外部动作
所必需的结构化材料，例如：

- capability；
- 明确目标和输入数据；
- 允许动作与写入授权；
- 期望结果和验收条件；
- 用于回传的最小 `towerContext` / trace 关联。

Operator 读取这份执行契约属于必要交接；让 o-tower 再读取完整 Tower 对话、项目历史或终端输出属于
重复推理，应从目标架构中排除。

### 8.4 单一维护责任

外部能力的以下内容只在 OpenClaw 管理：

- capability 名称和描述；
- capability 到 adapter / Operator 的映射；
- 本机 Agent、工具、凭据和授权；
- 消息渠道、账号和目标解析；
- 外部能力的可用性和运行健康。

Tower 只维护稳定的 Capability Port 客户端契约，不安装或复制飞书 MCP，不保存具体 Operator Agent ID，
也不维护 OpenClaw workspace 和本机命令。

### 8.5 迁移期单路执行

从现有 `tower-bridge` prompt 路由迁移到 Registry 契约期间，可以保留旧路径作为尚未切换 capability
的兼容入口，但每个 `requestId` 在提交前必须选定且只允许执行一条路径：

- 已经提交、已经返回 `ACCEPTED`，或可能已产生副作用的新路径，不得因超时或结果未知而回退旧路径；
- 影子验证只能比较 capability 解析和路由决策，不得同时执行两个 Adapter / Operator；
- capability 按真实 E2E 逐项切换，验证通过后再移除对应 prompt 中的具体 Agent 映射；
- 任何兼容回退都必须发生在确认请求尚未提交之前。

迁移兼容不能削弱 `requestId` 去重和 `SIDE_EFFECT_UNKNOWN` 规则，也不能制造双重发送或双重操作。切换
每个 capability 前，必须有覆盖其现有路由行为的回归测试（例如既有“发飞书 / 找小飞”路径切换后仍可用），
验证通过才移除对应 prompt 中的旧 Agent 映射；回归缺失时不得切换。

## 9. 第三步决议：统一 Capability Request 契约

Tower 和 o-tower 使用同一种版本化 `CapabilityRequest`。调用方表达需要什么，不指定由哪个 Agent、
工具或传输实现。Registry 负责解析 capability、计算风险等级并选择 Adapter 或 Operator。

### 9.1 Capability 命名

Capability 使用稳定的业务语义名，不使用 Agent 名、MCP namespace 或本机命令。建议采用
`domain.resource.verb`：

- `human.message.send`
- `computer.gui.inspect`
- `computer.gui.act`
- `feishu.document.read`
- `feishu.document.write`
- `feishu.sheet.read`
- `feishu.sheet.write`

具体列表由 OpenClaw Registry 发布和版本化。Tower 不内置一份完整目录，只消费 discovery 结果并按
稳定契约调用。

### 9.2 最小请求字段

所有能力共用一个 envelope，不为每个 Operator 新建一套桥接协议：

| 字段 | 语义 |
|---|---|
| `schemaVersion` | 契约版本；不兼容变化必须升级 major |
| `requestId` | 调用方生成的稳定幂等与关联 ID；同一语义重试必须复用 |
| `capability` | 业务能力名，不是 Agent 名 |
| `operation` | `READ` 或 `ACT`；只描述是否预期产生外部副作用 |
| `source` | 已认证来源：`TOWER` 或 `OPENCLAW`，以及必要 trace/task/session 关联（`towerContext` 即归于此，不是独立顶层字段） |
| `goal` | 一句话说明要达到的业务结果 |
| `inputs` | 完成动作所需的结构化数据、链接和受控文件引用 |
| `constraints` | 时长、步骤、数据外发、应用范围和禁止动作等限制 |
| `expectedOutput` | 调用方需要的结果字段和可观察验收条件 |
| `authorizationRef` | 可选的可信授权引用；不能用模型填写的 `authorized: true` 代替 |

请求中禁止出现：具体 Operator Agent ID、workspace 路径、底层命令、凭据、完整项目历史、完整终端
transcript，以及与当前动作无关的对话上下文。

`source`（含 `towerContext` / trace 关联）只用于认证、关联和结果回送，不自动授予外部写权限。调用 Tower
能力和调用电脑/飞书能力是两个不同的授权域。

### 9.3 Discovery 契约

Capability Registry 必须提供无敏感信息的 discovery，至少返回：

- capability 名称和版本；
- `READ / ACT` 支持情况；
- 版本固定、机器可解析的 input/output schema，或可解析且包含内容完整性标识的版本化 `schemaRef`；
- Registry 计算的风险等级；
- 当前 `AVAILABLE / DEGRADED / UNAVAILABLE`；
- 同步完成或异步 Job 的执行特征。

Discovery 不返回凭据、Agent 私有路径、模型配置或底层调用命令。能力不可用时必须明确返回
`UNAVAILABLE`，不能让调用方猜测或自行绕过 Registry。

Tower 可以缓存已固定版本的 schema，并在提交前做 fail-fast 预检；缓存版本与 Registry 不一致时必须
重新 discovery 或 fail-closed。该预检只减少无效请求，不构成信任边界：OpenClaw 仍必须在执行前做
权威 schema 校验、风险计算和授权验证。

## 10. 第四步决议：请求分类与主责任方

o-tower 只分类外部人类请求；Tower CLI Agent 只分类项目执行过程中产生的下一步动作。Capability Port
不读取自然语言历史重新分类，只验证结构化 capability 和策略。

| 请求特征 | 主责任方 |
|---|---|
| 普通知识问答、无需持久状态 | OpenClaw / o-tower 直接回答 |
| 依赖项目文件、长期上下文、任务拆解、版本或审查 | Tower |
| 即时消息发送、外部系统结构化操作 | OpenClaw Capability Port / Adapter |
| 桌面、浏览器、GUI 或复杂外部系统工作 | OpenClaw Capability Port / Operator |
| 项目交付物完成后需要外部发布 | Tower 为主；审查后调用外部 capability |
| 外部材料只是项目工作的输入 | Tower 为主；由 Tower 调 capability 获取最小必要材料 |

混合请求只选择一个主责任方，不让 o-tower 和 Tower 并行创建两份工作。选择标准是最终交付物归属：

- 最终交付物是项目文件、提交、审查结果或长期资产时，Tower 为主；
- 最终交付物只是一次外部状态变化或即时回复时，OpenClaw 为主；
- 边界不明确且会影响写入对象时，只追问一个最小澄清问题，不猜。

回复 Tower 卡片或带 `towerContext` 的消息仍先做只读上下文解析。状态查询不恢复任务；外部操作不
修改 Tower；只有明确继续、修复或重跑项目工作时才进入 Tower 的显式续跑路径。

## 11. 第五步决议：执行结果、持久化与恢复

### 11.1 两种执行车道

Capability Port 根据 Registry 描述选择执行车道，调用方不绑定具体实现：

| 车道 | 场景 | 返回方式 |
|---|---|---|
| Direct | 短时、确定性、边界清晰的 Adapter 调用 | 当前调用内返回最终结果 |
| Job | 多步 Operator、GUI、可能跨越调用超时的工作 | 先返回 `ACCEPTED + jobRef`，完成后推送结果 |

Job 采用完成事件或回调推进，不要求 Tower CLI 忙轮询。状态归 Capability Port / OpenClaw 所有，Tower
只保存 `requestId/jobRef` 的关联和对项目有意义的结果摘要，不镜像一套完整外部 Job 状态机。

Capability Port / OpenClaw 还必须提供按 `jobRef` 或 `requestId` 查询当前结果的只读能力，用于 Tower
重启恢复、回调丢失后的对账、超过预期完成时间后的核验和人工诊断。回调或完成事件仍是主路径，查询
只在恢复、对账、到期核验或明确请求时使用，不得退化成高频轮询。查询结果至少包含当前状态、结果
revision、`updatedAt`、已知副作用及其确定性；Tower 据此更新项目侧关联和摘要，但不复制外部状态机。

这是恢复契约要求，不预设需要新增 API 或 Job 存储。Technical Spec 必须先评估 OpenClaw 已有的
task / run / status 能力能否直接承载。

Direct 车道不创建通用 Job，也不为了统一而复制现有消息 outbox。只有首个真实异步 Operator 用例证明
现有 OpenClaw session / delegation 语义不足时，才为 Job 车道增加最小持久状态。

### 11.2 标准结果状态

| 状态 | 含义 | 是否自动重试 |
|---|---|---:|
| `SUCCEEDED` | 所有可观察验收条件均满足 | 否 |
| `FAILED` | 确认未完成，且副作用状态已知 | 仅按 retry policy |
| `BLOCKED` | 缺授权、输入、登录、能力或人工决策 | 否，先解除 blocker |
| `CANCELLED` | 已确认停止；已发生副作用必须单列 | 否 |
| `EXPIRED` | 到期前未开始或确认未产生副作用 | 可按新请求处理 |
| `SIDE_EFFECT_UNKNOWN` | 可能已经发送、提交、写入或删除，但无法验证 | **绝不自动重试** |

`ACCEPTED` 和 `RUNNING` 是 Job 的处理中状态，不是业务结果。超时只表示没有在等待窗口内拿到结果，
不能自动等同于 `FAILED`；一旦可能触发外部副作用，超时必须进入验证或 `SIDE_EFFECT_UNKNOWN`。

现有消息链路的 `SENT_UNVERIFIED` 与 `SIDE_EFFECT_UNKNOWN` 语义同类。Technical Spec 可以在 Capability
Port 边界做结果归一化，但不应只为统一名称迁移已经稳定的数据库枚举。

### 11.3 标准结果内容

最终结果至少包括：

- `requestId`、`capability` 和最终状态；
- 面向业务的简短摘要；
- 直接观察到的事实；
- 实际执行过的动作和已知副作用；
- 证据引用，例如截图或外部对象链接；
- 失败码、是否可重试和第一个 blocker；
- 是否需要人工决定以及建议的下一步。

工具调用成功不等于任务成功。Operator 只有在最终观察与全部验收条件一致时才能返回 `SUCCEEDED`。

### 11.4 幂等与重试

跨系统投递采用 at-least-once，依靠稳定 `requestId` 去重。下游支持幂等键时必须传递同一 ID；不支持
时不能宣称 exactly-once。

| 操作 | 允许的自动重试 |
|---|---|
| 只读查询 | 允许，使用退避和次数上限 |
| 有原生幂等键的写入 | 允许复用同一 `requestId` |
| 确认尚未开始的写入 | 允许重新领取 |
| 已经尝试但无法确认结果的发送、提交、发布、删除 | 禁止；转 `SIDE_EFFECT_UNKNOWN` |
| Operator 返回 `BLOCKED` | 禁止；等待输入或授权，不轮询轰炸 |

Job 完成回调本身可以重复投递，接收方按 `requestId + result revision` 去重；仅更高 revision / 更晚
`updatedAt` 可覆盖，已达终态不被非终态回调回退（防乱序回调把 `SUCCEEDED` 打回 `RUNNING`）。取消是
best-effort；取消成功不抹除取消前已经发生的动作和证据。发起取消但无法确认副作用是否已发生时，结果
为 `SIDE_EFFECT_UNKNOWN` 而非 `CANCELLED`，同样禁止自动重试。

### 11.5 持久化责任

- OpenClaw 持久化外部 Capability Job、执行租约、结果和外部副作用状态；
- Tower 在发起无人值守外部动作前，先持久化自己的项目意图和 `requestId` 关联；
- Tower 保存对任务审查有意义的结果、证据引用和决策，不复制 Operator 的全部运行日志；
- Adapter 的凭据、会话和重试细节不进入 Tower 数据库；
- 首版不建立跨系统共享表，也不让双方直接写对方数据库。

## 12. 第六步决议：无人值守 Goal 循环

项目型 Goal 的权威状态属于 Tower；不依赖项目的个人自动化或渠道工作流属于 OpenClaw。Capability
Port 只执行动作，不承担 Goal 规划和定时调度。

### 12.1 唤醒来源

Tower Goal 必须由持久事实唤醒，而不是依赖某个终端一直在线：

- 子任务完成、失败或请求决策；
- 人类回复 OPEN ask；
- 外部 Capability Job 完成、阻塞或副作用不确定；
- 持久化的下一次检查时间到期；
- Tower 重启后的恢复扫描。

事件回调是主路径，低频定时唤醒是恢复安全网。不得以高频轮询替代完成事件，也不得在 provider 回合
仍运行时向 PTY 注入新工作。可投递边界继续以 provider-confirmed turn completion 为准，且该完成信号必须
持久化，与其他唤醒源同级，进程重启后仍可判定，不依赖易失内存。

“人类回复 OPEN ask”这一唤醒源需要明确绑定权威：回复物理落在 OpenClaw 渠道，由 OpenClaw 依渠道 /
会话上下文**提议**绑定到某个 taskId / askId，Tower 对 OPEN ask 做**幂等的权威 resolve**——同一 ask 只被
answer 一次，重复或迟到投递为 no-op。即“OpenClaw 提议、Tower 裁决”，避免误绑或重复 resolve 造成
split-brain。

### 12.2 进度与看门狗

“终端一段时间没有输出”不是失败，也不是安全注入条件。看门狗根据持久化进度事实判断：最近完成的
步骤、活跃子任务、未解决 ask、外部 Job、租约和下一次唤醒时间。

进行中的长任务必须周期性续租约或写心跳事实，使“正常长耗时”与“已卡死”可区分：看门狗以**租约过期**
（而非进度静默）判定失联，再走下方阻塞 / 通知动作，不因一个正常但耗时的步骤误杀仍在执行的工作。

看门狗只能执行以下动作：

- 修复过期租约或重新排队确认未开始的安全工作；
- 唤醒处于安全回合边界的 Goal；
- 将无法自动判断的情况标为 `BLOCKED / DEGRADED` 并通知 OWNER。

它不能盲目重启仍在执行的 Agent，也不能重放副作用不确定的外部动作。

### 12.3 时间边界与防跑飞

每个无人值守 Goal 只使用一个用户可理解的生命周期边界：总运行时长，默认 8 小时。用户可在 UI 选择时长、
随时手动关闭；到期后保存状态、撤销授权并正常结束。provider 回合、子任务、失败事实、Capability Job、token
和金额可用于观测与告警，但不得让 Goal 进入 `BLOCKED`，也不得阻止创建新任务。外部副作用仍由 Gateway 的
逐项 OWNER 确认和 OpenClaw 幂等执行约束，不能用次数额度代替风险确认。

### 12.4 升级与完成

升级链固定为：子任务 -> 父 Workbench / Goal Hub -> OWNER。子任务不能绕过父级直接轰炸人类；父级
能决定时应自行处理，不能把同一个问题原样弹回子任务形成循环。

Goal 完成必须经过主责任方验收。完成后保存结果、停止继续唤醒、清除 goal mode，并发送一次去重的
完成通知。完成事实与通知投递是两个状态：Goal 完成后保持 `ENDED`；通知失败只进入独立、可恢复的通知状态，
不能把 Goal 改写成 `BLOCKED`。只有任务本身确实需要 OWNER 决策时才使用 `BLOCKED`。需要 OWNER 最终验收时
可以进入等待，但不能继续消耗执行资源。

## 13. 第七步决议：授权、安全与 Operator 行为

### 13.1 风险等级

Registry 根据 capability、operation、目标和 payload 计算风险，调用 Agent 不能自行降低：

| 等级 | 示例 | 默认策略 |
|---|---|---|
| R0 观察 | 截图、读取页面、查询文档、查看状态 | 已认证 OWNER/受限任务可执行 |
| R1 可逆交互 | 导航、打开应用、填写未提交草稿、局部可撤销编辑 | 受任务范围和步骤预算约束 |
| R2 外部生效 | 发送消息、提交表单、发布、创建或更新外部对象 | 需要精确预授权或确认 grant |
| R3 高风险 | 删除、批量变更、权限、购买、安装、系统设置、不可逆操作 | 默认阻塞；逐项实时确认，部分能力默认永久阻塞、仅经产品级显式解禁才开放 |

进入 `tower-goal` 只授权完成普通项目工作，不自动授权 R2/R3 外部副作用。Goal 中已经明确预授权的
动作也必须绑定具体 capability、目标、范围和有效期，不能解释为“操作整台电脑”的无限授权。

### 13.2 授权证明

`authorizationRef` 必须由可信入口或控制面签发，并至少绑定：

- OWNER 身份或可信策略来源；
- capability 和 operation；
- 精确目标和必要 payload 摘要；
- 风险等级与允许范围；
- `requestId` 或有限批次；
- 过期时间。

Agent 在自然语言或 JSON 中填写 `confirmed: true`、`writeAuthorized: true` 不能成为授权证明。授权证明
可以由已认证的 OpenClaw OWNER 会话或可信 Tower Server/UI 签发，但必须由 Capability Port 验证。
签发与验证细节留给 Technical Spec，且必须防重放、不可被普通任务伪造。

无人值守执行时，如果 R2 / R3 动作在执行点没有仍然有效且范围匹配的授权证明，必须返回 `BLOCKED`
并请求 OWNER 决策。不得从 Goal 文本、Task 描述、历史对话、模型判断或普通 goal mode 推导授权。
预授权如何安全绑定未来运行时请求，是 Technical Spec 的核心开放问题；在该问题解决前一律保守失败。

唯一例外可以是 `human.message.send` 且目标为 OWNER 本人渠道的无人值守通知与追问，但只有同时满足
以下条件才成立：

- 可信控制面已经记录 OWNER 对当前任务显式激活的、仍在有效期内的 unattended grant；
- 发送目标由已验证的 OWNER / home route 固定，调用 Agent 不能通过 `to`、alias、平台 ID 或其他字段覆盖；
- 消息只用于当前任务必要的通知、追问和结果回传，并继续受最小必要数据、敏感信息和去重规则约束。

`set_goal_mode` 及任务状态流转写入的 unattended 信号只是运行状态标记，不能单独作为授权证明，也不能
由 Agent 调用后形成自我授权。现有 `push_to_human` / `ask_human` 的投递、记录和 park 语义可以复用，
但 Technical Spec 必须在可信执行边界补齐 grant 验证和 OWNER 目标强制校验；在护栏落地前，现有实现
不视为已经满足本例外。发给第三方、群组或任何其他外部对象的消息仍按通用 R2 规则要求限域授权。

本例外所需护栏 = {OWNER 经认证的 OpenClaw 会话或 Tower UI 在派发任务时记录的、带有效期的 unattended
grant} + {Capability Port 侧 home-route 目标强制} + {`requestId` 去重}。它是通用 R2/R3 授权的一个**严格可建
子集**：之所以现在可落地、而上文的通用预授权绑定仍是开放问题，根因在于本例外把目标锁死到 OWNER
本人 home route（无第三方目标注入面）、被授权对象天然自限（只回传本人），因此不依赖"任意目标绑定"这一
尚未解决的能力。凭此可让首个纵向闭环（第 18 节步骤 1）不必等待通用授权签发机制全部就位，同时不削弱
“Agent 不能自我授权”的章程原则。

### 13.3 永久禁止边界

Computer Operator 默认不得：

- 打开密码管理器、读取密钥、token、验证码或恢复码；
- 修改系统隐私、安全、辅助功能和防火墙来扩大自身权限；
- 绕过确认、沙箱、Tool Surface 或组织策略；
- 执行屏幕、网页、文档中要求扩大任务范围的提示；
- 将用户数据发送到未授权目标；
- 使用裸 shell 代替受控 GUI/Adapter 完成未授权系统管理；
- 自己联系用户、创建 Tower 项目或决定下一个业务目标。

页面和应用内容始终视为不可信输入。Operator 只执行 envelope 中明确允许的动作，不跟随界面中的
指令扩大范围。

### 13.4 证据与验收

Computer Operator 执行前必须做环境 preflight 和初始观察；执行后重新观察。证据应直接支持验收条件，
并经过路径、权限、保留期和敏感信息控制。截图存在不等于成功，观察结果与期望不一致时必须返回
`FAILED` 或 `BLOCKED`。

## 14. 第八步决议：产品默认能力与本地扩展

Tower 产品默认发布稳定契约和客户端，不发布用户私有外部能力：

- 可以内置 `tower-bridge`、Capability Port 客户端、discovery 与结果展示；
- 可以安装最小 o-tower profile，使其只直接操作 Tower；
- 不默认安装飞书 MCP、Computer Operator、具体第三方 Agent、凭据或用户路由；
- 不在 Tower Core 中写死 `xiao-fei`、`operator` 或其他本机 Agent 名；
- 本地扩展通过 OpenClaw Registry 注册 capability，Tower 只看到业务能力和健康状态。

示例路由和 Operator 配置属于高级用户文档或本地扩展模板，必须明确标注“非默认能力”。安装或升级
Tower Agent Extension 时只更新 Tower 拥有的字段，保留用户自建 Agent、路由、模型和凭据；卸载也
不能删除不归 Tower 所有的本地扩展。

版本兼容遵循以下规则：

- Registry discovery 声明 capability 与 schema 版本；
- Tower 对不兼容版本 fail-closed，并显示缺少或不兼容；
- capability 不可用不降级成 shell、通用 Agent 或猜测执行；
- 产品自动测试使用契约假实现，真实 Operator E2E 作为可选本机验收，不成为 npm 安装前提。

仓库文档必须区分“Tower 默认产品能力”和“当前用户机器已安装能力”。本机存在 Computer Operator
不表示公开 npm 包默认提供 Computer Use。

## 15. 数据归属

| 数据 | 权威所有者 |
|---|---|
| sender、channel、外部会话和 OWNER 身份 | OpenClaw / Gateway |
| capability、风险策略和本地 Operator 映射 | OpenClaw Capability Registry |
| 外部 Capability Job、租约和副作用状态 | OpenClaw 能力运行时 |
| Workspace、Project、Task、Execution、Review、Goal | Tower |
| Tower 发起的外部请求关联、项目审查结果 | Tower |
| Tower 任务的 ask/notify 意图、OPEN/reply/park 生命周期 | Tower |
| 平台传输尝试、平台回执和外部账号健康 | OpenClaw / Gateway；Tower 可保存任务级投影 |
| work/unattended 等任务通知策略 | Tower；只引用 OpenClaw 的逻辑 channel/capability，不复制凭据和地址簿 |
| 项目知识、项目文件和项目交付物 | Tower 所登记的项目工作区 |
| GUI 操作的即时观察与原始截图证据 | Computer Operator / OpenClaw，按策略回传引用 |
| 飞书文档、表格、知识库和云盘对象 | 飞书；Feishu Adapter / Operator 只执行和回报 |

跨系统传递的 context 只用于认证、关联、执行和结果回送，不应演变成复制另一系统全部状态的影子
数据库。双方可以各自保存业务所需摘要，但只有上表指定的系统是该事实的权威来源。

## 16. 明确不做

- 不把 Capability Port 扩成新的项目编排器、工作流 DSL 或自然语言 Agent；
- 不在 Tower 建立第二份 capability / Agent 路由和凭据配置；
- 不强制每个外部动作经过 o-tower 或第二次 LLM 推理；
- 不把所有一次性外部操作包装成 Tower Task；
- 不引入 Kafka、Redis、NATS、跨系统共享数据库或通用 Event Bus；
- 不承诺 GUI 和不支持幂等键的外部写入 exactly-once；
- 不自动重试 `SIDE_EFFECT_UNKNOWN`；
- 不以完整 transcript、截图全集或项目目录作为默认委托上下文；
- 不建设通用 RPA 可视化编辑器；
- 不让 Tower 管理非项目型个人自动化，也不让 OpenClaw 管理项目事实；
- 本章程阶段不决定 Capability Port 的具体传输、表结构、API 名称和部署形式；
- 不因逻辑边界图而直接新增服务、共享数据库或通用事件总线。

## 17. 验收与验证方式

以下条目首先是架构和产品验收断言，不强行把不可运行验证的产品边界伪装成自动化测试：

1. 新增文案、书稿等非代码项目时，Tower 的核心定位不需要改变。
2. 一次性 GUI 或外部操作不需要为了执行而创建 Tower 任务。
3. 外部 Operator 的替换不要求修改 Tower 项目模型。
4. OpenClaw 和 Tower 不维护两套 capability-to-agent 路由。
5. 开发者直接使用 Tower 与外部用户通过 OpenClaw 使用 Tower 可以同时成立。
6. Tower 反向调用外部能力不会让 OpenClaw 成为项目事实所有者。
7. Tower 发起外部能力请求时，不经过 o-tower 重新读取完整项目上下文。
8. 简单消息发送不启动第二个 Agent，复杂外部工作才交给 Operator。
9. Tower 和 o-tower 使用同一份 Capability Registry 和请求契约。
10. 更换 Adapter 或 Operator 时，Tower 客户端契约保持稳定。
11. 混合请求只有一个主责任方，不重复创建工作。
12. 外部 Job 重启恢复时不需要 Tower 复制 OpenClaw 状态机。
13. 可能已产生副作用的超时不会被自动重试。
14. 普通 goal mode 不会静默扩大为发送、发布、删除或系统设置授权。
15. 终端静默不会被误判为安全回合边界。
16. 产品默认安装不依赖用户本地 Operator，存在本地 Operator 时又能通过 discovery 使用。

Technical Spec 必须把可验证部分落实到以下四类门禁；同一断言可以由多类证据共同覆盖：

| 验证类型 | 主要覆盖 | 最低要求 |
|---|---|---|
| 架构一致性检查 | 1–11、16 | 检查依赖方向、数据归属、发布边界及 Tower 中不存在具体 Agent、凭据和第二套路由 |
| 契约测试 | 4、8–10、12–14、16 | 覆盖 discovery/schema 兼容、请求去重、单路执行、Job 状态查询、结果映射、授权 fail-closed 和 OWNER 目标不可覆盖 |
| 故障注入 | 12–15 | 覆盖回调丢失、进程重启、重复投递、超时、取消、授权缺失和 `SIDE_EFFECT_UNKNOWN` 不重试 |
| 真实 E2E | 2、5、7、8、11、12、16 | 覆盖简单消息、一个真实 Operator、唯一主责任方、证据回传及重启后对账恢复 |

架构原则由设计决策记录、静态检查或依赖审计验收；具备可执行行为的断言才成为 CI 契约测试或 E2E 门禁。
本机真实 Operator E2E 可以是发布前环境验收，但不能成为普通 npm 安装或无本机扩展 CI 的前提。

## 18. 交付顺序与当前进度

本章程、架构图解和 Technical Spec 已收敛为同一套最终交付基线。后续只在实现证据改变架构事实时
原地更新这些权威文件，不保留评审轮次、候选稿或 `v1` / `v2` 副本。

Technical Spec 应按第 8 节的实现优先级验证当前 OpenClaw 原生能力，并记录复用、薄适配或新增组件的
证据。不得把逻辑契约边界直接翻译为一个新服务。

实施顺序保持小步纵向闭环。当前已经完成模块边界收口、goal 授权语义修正，以及 OpenClaw 原生 Job
只读对账薄适配；其余步骤仍按以下顺序推进：

1. discovery + Direct 消息发送，不启动 Operator。本步同时交付 §13.2 例外所需的最小授权护栏，且授权按
   在场状态分两条路径：有人值守（开发者在场）无需预先签发 unattended grant，但必须由已认证 OWNER 会话
   产生绑定当前请求的一次性授权证明；无人值守发往 OWNER 本人渠道时，必须校验已记录的限域 unattended
   grant 并由 Capability Port 强制 home-route 目标。该护栏是步骤 1 的交付内容，不得悬空到后续步骤；
2. 一个 Tower 请求经 Capability Port 调用现有 Operator 并返回证据；
3. Job 完成事件、去重和 `SIDE_EFFECT_UNKNOWN`；
4. o-tower 与 Tower 共用 Registry，按第 8.5 节逐项切换并移除 `tower-bridge` 的具体 Agent 路由；
5. Goal 唤醒、预算和看门狗接线；
6. 扩展更多 capability，做真实渠道和 GUI E2E。

## 19. 决议记录

| 日期 | 决议 |
|---|---|
| 2026-08-01 | OpenClaw 是个人工作流中层和电脑能力中枢，Tower 是项目工作中枢 |
| 2026-08-01 | Tower 面向文件工作区中的项目型长期工作，不限定为代码仓库 |
| 2026-08-01 | 外部 capability 到具体 Operator 的映射由 OpenClaw 唯一拥有，`tower-bridge` 不建立第二套路由 |
| 2026-08-01 | Capability Port 是外部能力契约边界，不预设新组件；实现优先复用 OpenClaw 原生能力 |
| 2026-08-01 | Tower 通过非 LLM 契约调用 OpenClaw 的唯一能力中心，不经过 o-tower 二次推理 |
| 2026-08-01 | 简单发送走确定性 Transport / Adapter，只有复杂外部工作才启动 Operator |
| 2026-08-01 | Tower 与 o-tower 共用一个版本化 CapabilityRequest；请求不携带具体 Agent 和底层命令 |
| 2026-08-01 | 外部 Job 状态归 OpenClaw，Tower 只保存项目关联和审查结果 |
| 2026-08-01 | 副作用不确定统一进入 `SIDE_EFFECT_UNKNOWN`，禁止自动重试 |
| 2026-08-01 | 项目 Goal 归 Tower，个人工作流归 OpenClaw，Capability Port 不承担调度 |
| 2026-08-01 | goal mode 不自动授予 R2/R3 外部操作；高风险授权必须是可信、限域、可过期的 grant |
| 2026-08-01 | OWNER 本人 ask/notify 仅在可信 unattended grant 和固定 OWNER route 下作为窄例外；`set_goal_mode` 不是授权证明 |
| 2026-08-01 | Tower 默认发布契约和客户端，不默认发布或接管用户本地 Operator 与第三方凭据 |

## 20. 后续阶段的持续校验项

1. Tower、OpenClaw、Capability Port、Operator 的状态所有权不得重叠。
2. 非 LLM Capability Port 必须消除 o-tower 二次推理，且不得形成第二个 Gateway。
3. 通用 envelope 只承载稳定公共语义；确有独立约束的 capability 使用版本化专属 schema。
4. `SIDE_EFFECT_UNKNOWN`、取消和 timeout 必须覆盖真实外部系统的不确定性，未知副作用绝不自动重试。
5. R2 / R3 限域授权必须明确可信签发者，并绑定 capability、目标和有效期，防止任务 Agent 自我授权或重放；
   具体外部操作没有确认时必须通过 Gateway 询问 OWNER，由 OpenClaw 执行并回传结果，不能依赖次数额度。
6. Goal 唤醒和看门狗必须依赖持久事实，不得依赖终端静默或易失内存。
7. OpenClaw 持久化 Job，Tower 只保存最小关联与项目摘要；恢复能力不得演变为影子状态机。
8. 每个纵向增量只引入当前闭环必需的复杂度，尚无运行证据的抽象继续推迟。
9. `tower-bridge`、o-tower profile、`push_to_human` 与 Operator 路径按单请求单路径原则渐进迁移。
10. 产品默认能力与本机扩展必须在发布、升级、卸载和文档上保持分离。

## 相关文档

- [`ultimate-unattended-computer-architecture.md`](./ultimate-unattended-computer-architecture.md)
- [`ultimate-unattended-computer-technical-spec.md`](./ultimate-unattended-computer-technical-spec.md)
- [`ultimate-unattended-computer-acceptance.md`](./ultimate-unattended-computer-acceptance.md)
- [`o-tower-personal-assistant-security-and-operations.md`](./o-tower-personal-assistant-security-and-operations.md)
- [`tower-modular-event-architecture-target.md`](./tower-modular-event-architecture-target.md)
- [`tower-agent-extension.md`](./tower-agent-extension.md)
- [`gateway-workbench-routing.md`](./gateway-workbench-routing.md)
- [`tower-loop-hub.md`](./tower-loop-hub.md)
