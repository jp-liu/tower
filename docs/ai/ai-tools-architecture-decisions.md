# AI Tools 接入架构决策

> 状态：0.3.0 已实现本文标记的首版边界；“后续”内容仍是设计依据，不代表已经发布。
> 最后更新：2026-07-26

## 目标

把 Tower 的 AI 能力拆成可独立替换的连接与能力插槽，使任务终端、助手、执行总结、知识沉淀和项目分析不再绑定 Claude。内置实现与社区扩展遵循同一套接口，不为内置 Provider 保留私有通道。

## 设置页结构

AI Tools 设置页分为上下两层：

1. **连接管理**：管理可用的 CLI 连接与 API 连接，负责检测连接是否可用以及维护连接所需配置。
2. **插槽管理**：为 Tower 的每个 AI 使用场景选择连接、调用模式和模型。

连接只描述“有哪些 AI 能力可用”，插槽负责决定“某个功能实际使用哪一个连接”。同一个连接可以被多个插槽复用，各插槽也可以独立切换。

## 连接类型

### CLI 连接

- Tower 内置支持 Claude Code、Codex CLI、Gemini CLI。
- CLI 自己负责登录、Token、API Key、Base URL 等认证与网络配置，Tower 不接管这些配置。
- Tower 只管理 CLI 的发现、连接测试、进程启动、会话恢复、事件/Hooks、MCP 和 Skill 等集成能力。
- `terminal` 插槽只允许使用 CLI 连接，API 连接不能用于交互式任务终端。

### API 连接

- 用户可以配置 `Base URL`、`API Key` 和模型。
- API 连接服务于 `summary`、`dreaming`、`analysis`、`assistant` 等非终端能力。
- API 连接不向 CLI 注入 API Key，也不代替 CLI 自身的登录和配置。

### API 调用底座与首版协议

- 使用 Vercel AI SDK 作为 API 调用底座，统一文本生成、流式输出、结构化输出和工具调用。
- Tower 在 Vercel AI SDK 之上保留一层薄 `ApiAdapter` 接口；业务插槽和第三方扩展不直接依赖具体 SDK。
- 不默认使用 Vercel AI Gateway。请求直接发送到用户配置的上游地址，API Key 只保存在本机。
- 首版同时实现以下四类协议：
  - `openai`：OpenAI 原生 Provider，保留 Responses API 和官方特有能力。
  - `openai-compatible`：任意兼容 OpenAI API 的服务和自定义 Base URL。
  - `anthropic`：Anthropic 原生协议与能力。
  - `google`：Google Generative AI 原生协议与能力。

### 模型管理

- 模型管理采用“自动获取 + 手动补充”，不能只依赖 Tower 内置名单或上游模型接口。
- 各 API Adapter 实现 `listModels()`；不支持模型列表接口或获取失败时，用户仍可手动输入模型 ID。
- 上游模型目录是本地缓存，不是 Tower 的限制名单。模型 ID 始终允许自由输入。
- 模型来源区分 `discovered` 与 `manual`；刷新模型不能删除手动添加的模型。
- 上游不再返回但仍被插槽引用的模型标记为不可用，不直接删除配置。
- 插槽保存稳定的 `connectionId + modelId`。
- 能力信息只使用上游明确返回的数据；无法确认时标记为未知，不根据模型名称硬猜，也不阻止用户选择。
- 只有上游明确声明某项能力不支持时，才在依赖该能力的插槽中禁用；未知能力在实际调用失败时返回明确错误。
- 连接测试使用用户选定模型发起最小生成请求；仅成功获取模型列表不等于连接可用。

### 连接实例

- “Provider/协议”是连接的实现类型，“连接”是用户实际配置的实例，两者不能混为一个标识。
- 同一种协议允许创建多个连接，例如“我的 OpenRouter”“公司 NewAPI”“本机 Ollama”。
- 能力插槽引用稳定的 `connectionId` 和模型，而不是只保存 Provider 名称与 mode。
- CLI 内置连接同样作为连接实例参与插槽选择，内置实现不走私有路由。

### 连接预设

- Adapter 决定协议调用方式，Preset 只负责预填元数据，Connection 保存用户最终配置；三者不能共用一个 Provider 枚举。
- 使用 MIT 许可的 `models.dev` 社区目录生成 Tower 的本地预设快照，提取名称、默认 Base URL、协议映射、文档地址和 Logo。
- 预设快照在构建/发版时更新，Tower 启动和设置页不能依赖 `models.dev` 在线服务。
- 实际可用模型仍以用户连接的上游模型接口和手动配置为准，预设目录不是模型限制名单。
- 始终提供“自定义 OpenAI Compatible”入口；选择任何预设后，用户仍可编辑所有连接字段。

### Base URL 与高级请求配置

- 预设填入协议所需的完整 Base URL；用户输入只去除首尾空格和末尾 `/`，Tower 不自动添加 `/v1` 或改写路径。
- Base URL 只允许 `http://` 和 `https://`；允许 localhost、局域网地址和 HTTP 本地模型服务。
- 禁止在 URL 中嵌入用户名、密码或 Fragment；设置页显示不含凭据的最终请求地址预览。
- API Key 允许为空，以支持 Ollama、LM Studio 等无需认证的本地服务。
- API 连接支持自定义 Headers 和 Query Parameters，每项可以独立启停。
- 禁止覆盖 `Host`、`Content-Length`、`Connection` 等传输层 Header；其他 Header 允许配置，包括显式覆盖 `Authorization`。
- 名称包含 `authorization`、`token`、`key`、`secret`、`cookie` 的 Header/Query 值默认掩码，但用户可以查看和编辑。
- 自定义 Header 与 Query 参数不得进入普通日志，并随连接和完整备份一起保存。

## 能力插槽

当前确认的插槽边界：

| 插槽 | 用途 | 可用连接模式 |
|------|------|--------------|
| `terminal` | 任务终端执行 | CLI |
| `summary` | 任务执行小总结 | CLI / API |
| `dreaming` | 知识点总结与知识沉淀 | CLI / API |
| `analysis` | 项目分析与描述生成 | CLI / API |
| `assistant` | Tower 内置助手 | CLI / API |

各插槽独立选择 Provider/连接和模型。一个连接故障不应迫使所有 AI 功能一起切换。

### 故障切换与功能降级

- 故障处理分为三层：连接内部的健康 Key 轮换、插槽显式配置的有序连接回退、全部目标失败后的功能级降级。
- 每个插槽保存一个主目标和零个或多个有序备用目标；目标均明确引用 `connectionId + modelId`。
- 备用目标默认留空，只能由用户主动添加和排序。Tower 不得在运行时临时选择未声明的 Provider 或“第一个可用连接”。
- 同一请求只有在尚未产生内容、工具调用或其他副作用时，才允许切换 Key 或备用目标。
- 用户取消、内容安全拒绝、请求配置错误和工具执行错误不触发跨连接回退。
- 结构化输出解析失败时，可以先在当前目标执行一次修复请求，仍失败再进入下一个显式目标。
- `summary`、`dreaming`、`analysis` 可以按单次请求执行回退；`assistant` 只能在当前轮首个流式内容或工具调用前回退。
- `terminal` 只允许在新会话创建前因 CLI 缺失、探测失败或启动失败而回退；会话创建后固定绑定原 CLI，恢复会话不得切换 Provider。
- 全部目标失败后按功能降级：Summary 保留确定性的 Git/提交摘要，Dreaming 跳过并允许稍后重试，Analysis 保留原内容，Assistant 显示本轮失败，Terminal 明确报告启动失败。
- Tower 统一规范化 Provider 错误并决定重试、Key 轮换和目标回退；Adapter 不自行叠加不可见的跨连接重试。
- 记录每次尝试的插槽、连接、模型、错误码和耗时用于诊断，但不记录 Prompt、API Key 或敏感 Header/Query 值。

## CLI 扩展机制

- 抽取公共 CLI Adapter 基类/接口，并发布为可供第三方依赖的公共 npm 包。
- Claude、Codex、Gemini 内置支持也使用这套公共接口实现，以验证扩展接口具备完整能力。
- QCoder、Cursor、Kimi 等其他 CLI 可以由 Tower 官方或社区作为独立扩展发布。
- 社区开发者可以自行实现 CLI Adapter；Tower 提供固定、稳定的接入点，定位类似 Raycast 的扩展契约。
- 0.3.0 扩展系统首版只支持 `cli-provider`，不提供通用命令模板、任意脚本扩展或 API Provider 扩展。
- 用户只有两条接入路径：从 Tower 扩展中心的受信任 Catalog 安装不可变产物，或使用公共 SDK 注册本地目录进行开发调试。正常安装不要求 npm 包名，也不在用户机器执行 npm 命令。
- `o-tower` 是独立 Agent 产品，不进入本扩展 Catalog、Manifest 或 Runtime。

### 公共 SDK v1 边界

- 首版公共 SDK 只开放 CLI Provider 扩展；API 连接先使用 Tower 内置的四类协议和自定义 OpenAI Compatible，不开放任意 API Adapter 插件。
- 公共契约以接口和 `defineCliPlugin()` 为准，同时提供 `BaseCliAdapter` 复用默认行为；社区实现不强制继承基类。
- Adapter 只描述 CLI 的探测、参数构造、输出解析和集成安装方式；PTY、进程生命周期、任务状态、超时、取消和回收始终由 Tower 宿主管理。
- Terminal 启动由 Adapter 返回结构化 `command + args + envPatch + initialInput`，禁止返回 shell 命令字符串，默认禁止 `shell: true`。
- 查询协议提供 `generate()` 和可选 `stream()`，统一输出文本、推理、工具调用、用量、会话、结束和错误事件。
- MCP、Hooks、Skills 是三个独立的可选子接口，分别提供 `inspect`、`install`、`uninstall`。
- Adapter 通过 Host Context 使用受控命令执行器、脱敏日志、插件存储路径、平台信息和取消信号；Tower 不向插件传递数据库对象、其他连接配置或 API Key。

### Extension Manifest 与配置 Schema

- Manifest v1 使用稳定扩展 `id`，一个产物只贡献一个 `cli-provider`。扩展 ID 不从下载 URL、npm 包名或本地目录名推导。
- 预构建产物仍可使用 Node ESM 包布局：Manifest 位于 `package.json` 的 `tower` 字段，入口由 Manifest 的 `entry` 显式声明并且必须与标准 `exports["./tower-cli-provider"]` 一致。静态清单必须在加载扩展代码之前完成校验。
- Manifest 至少包含 `manifestVersion`、`apiVersion`、`id`、`kind`、发布者、显示信息、入口、Tower/Node 兼容版本、能力、权限、配置 Schema，以及底层 CLI 依赖声明。
- 底层 CLI 依赖声明包含依赖名称、主页、安装文档、支持版本范围、默认命令、别名/少量已知路径和版本探测参数；`managedByTower` 在首版必须为 `false`。
- 发布者、Catalog、CLI 依赖和可选显示主页只接受 HTTPS URL；版本探测参数必须至少包含一个非空参数，避免意外启动裸交互 CLI。
- `manifestVersion` 管清单格式，`apiVersion` 管运行时接口，扩展版本继续遵循 SemVer，三者不能混用。缺少新必填身份、入口或依赖字段的早期 v1 Provider 必须收到显式迁移诊断，不能被静默误读。
- 配置采用 JSON Schema 2020-12；Tower 只增加 `x-tower` UI 标注，不允许插件注入 React 组件或设置页脚本。
- 首版配置控件支持文本、数字、开关、单选、多选、路径、字符串列表和键值表，并支持顺序、分组、高级项和敏感值标记。
- Connection 的名称、启用状态、命令覆盖、基础参数和高级环境变量由 Tower 统一管理；插件 Schema 只描述自己的 `settings`。
- CLI 不增加专用 Token/Base URL 字段；高级环境变量继续作为兼容入口，敏感名称默认掩码。

### 命令发现与执行

- 命令发现统一由 Tower Runtime 实现，插件不得各自调用 `which`、`where` 或无边界扫描磁盘。
- 解析顺序为：Connection 的 `commandOverride`、Manifest 默认命令、插件声明的候选别名、当前及补充 PATH、插件声明的少量已知安装路径、用户手动选择。
- macOS/Linux 支持常见用户和包管理器 bin 路径；Windows 支持 `PATHEXT`、`.exe/.cmd/.bat` 和 npm shim 解析。
- 不自动执行用户的 shell 启动脚本；自动探测失败后由用户选择绝对路径。
- 自动解析路径只作为诊断缓存，不替代原始命令配置；每次启动前重新验证，失效时自动重新解析。
- 连接状态区分未找到、已找到、可运行和已连接；`--version` 成功后仍需执行最小 Hello Probe 才算连接成功。
- 多个候选同时存在时默认遵循 PATH 顺序，并在设置页展示路径和版本供用户切换。
- 安装前必须使用相同的共享 command resolver 核验 Manifest 声明的底层 CLI。探测只使用 `execFile` 语义和参数数组，使用短超时、最小安全环境且禁止 shell。
- CLI 缺失、不可执行、版本无法解析或版本不满足 Manifest 范围时阻止安装，并返回包含依赖、路径、检测版本和安装文档的结构化诊断。
- Tower 只核验第三方 CLI；不负责安装、更新、登录或修改其配置。

### Catalog、Artifact 与安装信任边界

- 官方与社区扩展通过受控仓库/CI 产物进入 Tower 官方 Catalog。Catalog 是受信任的静态 HTTPS 索引，也允许测试 fixture；它不是 npm Marketplace。
- Catalog 元数据只负责发现和展示，包含扩展 ID、版本、下载 HTTPS URL、SHA-256、字节大小和发布者等字段。Catalog 中复制的 CLI 依赖信息只用于展示，安装决策必须读取下载、校验后的运行时 Manifest。
- Artifact 是预构建、不可变的 bundle/tarball。Tower 不在用户机器运行 `npm install`、生命周期脚本、任意 shell 或本地编译，也不接受原生模块。
- 下载必须先进入 `~/.tower/extensions/.staging/`，并依次校验 HTTPS、响应/实际大小、SHA-256、归档路径穿越、symlink/hardlink、Manifest、配置 Schema、权限、Tower/Node 兼容性和底层 CLI 兼容性。
- Artifact 硬限制为最多 4,096 个归档条目、单个普通文件最多 64 MiB、总逻辑解压大小最多 256 MiB；归档预检和实际解压使用同一组限制，解压后再按 `lstat` 的逻辑大小复核并拒绝稀疏、非普通或符号链接条目。
- 只有全部校验通过后才能原子重命名到 `~/.tower/extensions/cli-provider/<id>/<version>-<digest>/`；registry 更新失败必须回滚新目录，升级失败必须保留旧注册和旧版本。
- 安装计划和 registry 保存确定性的 package-tree SHA-256：摘要覆盖排序后的安全相对目录/文件路径、文件字节和文件大小，明确不包含 mode 以保持跨平台确定性。Catalog/NPM 目标复用、inspect 和 load 均重新计算；任何嵌套依赖或其他文件变化都返回 `PLUGIN_CORRUPT`。
- registry 使用可迁移的版本化格式。Runtime 读取并迁移旧 `~/.tower/ai/plugins/registry.v1.json` 注册，保留旧安装路径作为 `legacy` 来源；迁移不得修改或删除用户的旧目录。升级前缺少 package-tree 摘要的 v2 记录仍可读取和列出，但必须重新安装或重新注册后才能 inspect/load。
- 本地目录注册必须显式记录为 `development` 来源并保持原目录不复制，供公共 SDK 作者调试。Catalog 安装记录为 `catalog` 来源。
- 首版扩展仍是本地可信 Node.js 扩展，不承诺操作系统级沙箱；权限清单用于安装前提示、最小化上下文和审计。
- 插件安装后默认禁用，用户确认权限并启用后才按需加载；Tower 启动时不得激活全部第三方插件。
- 更新先验证新版本再原子切换，失败时保留旧版本；同时支持本地目录开发模式。

### Runtime 与应用层边界

- 私有 Runtime 提供稳定的 `list`、Catalog 发现/安装计划、`install`、`enable`、`disable`、`uninstall`、`recheck` 和本地目录注册接口。
- 现有 npm 插件 Runtime 暂作旧版兼容读取与迁移入口，不再是正常用户安装协议；内置 Claude/Codex/Gemini、API 连接、五插槽、Assistant 和 Terminal 继续使用既有 Provider/能力 Runtime。
- 设置页“扩展中心”和 server actions 已接通上述接口。Catalog URL 只从服务端 `TOWER_EXTENSION_CATALOG_URL` 或系统配置键 `extensions.catalogUrl` 读取；浏览器只接收经过裁剪的目录、计划和结构化诊断，不接收 URL、文件路径或底层错误。

### CLI Provider 集成 Reconciliation 契约

内置 Claude/Codex/Gemini 和已启用的 `cli-provider` 扩展必须进入同一个 Host 生命周期。静态 Provider Map 只保存内置实现；平台能力中心使用异步枚举接口合并内置 Provider、扩展 registry 和 CLI Connection。动态扩展只有在产物完整、已启用、当前安装计划的全部权限已经确认时才进入可执行集合，枚举本身不得加载第三方代码。Terminal、能力插槽和 CLI query 在选中具体 Connection 后再通过统一解析接口加载对应 Adapter，因此新增动态 Provider 不需要修改 Tower 的静态源码注册。

Tower Host 是集成期望状态的唯一所有者。Host 根据当前 Tower 包、数据目录和本机 API URL 构造 MCP/Hooks/Skills 参数；根据 Manifest capability 与已确认的 `integration:mcp`、`integration:hooks`、`integration:skills` 权限决定目标集成。Provider 只通过公共 SDK Adapter 的三个可选子接口实现自身配置格式和实际操作，每个接口都必须提供幂等的 `inspect/install/uninstall`。Host Context 只提供受控进程、脱敏日志、插件存储和获准的 Provider 配置路径，不传递数据库对象、其他 Connection、API Key 或未声明权限对应的资源。

一次 reconciliation 固定执行以下状态机：

1. 读取扩展启用/权限确认与 Connection 配置，计算 desired integrations；禁用、卸载、产物损坏或权限未确认时停止，不加载 Adapter、不注入。
2. 统一解析 CLI 命令并校验 Manifest 声明的支持版本。CLI 缺失时记录 `dependency-missing`，版本不满足时记录 `dependency-incompatible`，两者均保持扩展安装状态但跳过集成和 Hello。
3. 使用 Adapter 子接口 `inspect` CLI 的真实用户级配置，只对缺失项调用 `install`，已存在项不得重复写入。
4. 再次 `inspect` 验证全部 desired integrations；验证结果而非 `install` 返回值决定最终集成状态。
5. 在需要连接核验的触发点执行最小 Hello；只有依赖、集成核验和 Hello 各自的结果都已记录后才更新 Connection 缓存与安全诊断。

CLI 配置文件和 Provider CLI 的实际检查结果是事实来源，`ProviderConnection` 仅缓存最近一次结果。Host 稳定计算 integration fingerprint，至少覆盖 Tower 集成 schema/Tower 版本、Provider 或扩展版本、解析后的命令路径、CLI 版本、目标集合集及相关非敏感配置摘要。摘要使用键排序后的结构化数据和 SHA-256；敏感 settings、环境变量值、API Key、完整 Provider 错误不得进入 fingerprint、数据库诊断或日志。缓存同时记录最近 reconciliation 时间、触发原因、各集成的 `not-requested/missing/installed/failed` 状态和脱敏错误码。路径或版本变化必然改变 fingerprint；即使 fingerprint 未变，也必须按触发策略重新 inspect，不能因数据库显示已安装而跳过事实检查。

| 触发点 | 枚举范围 | 行为 |
|---|---|---|
| Tower Node 启动 | 内置 + 已启用且权限已确认的动态 Provider | 后台 inspect/repair；依赖恢复后再 Hello |
| 扩展安装并确认启用 | 当前扩展 | 首次 reconciliation；安装但未确认时不运行 |
| 扩展升级或重新启用 | 当前扩展 | 复用原权限确认；新增权限使确认失效并阻止静默注入 |
| CLI Hello 成功 | 当前 Connection | 以已成功 Hello 为前提执行 inspect/repair/verify 并缓存 |
| Terminal 会话 spawn 前 | 本次候选 CLI Connection | 同步 reconciliation；失败目标进入既有 fallback，不先启动 PTY |
| 解析命令路径或 CLI 版本变化 | 当前 Connection | fingerprint 失效，重新 inspect/repair/verify，随后 Hello |
| 用户“重新检测并修复” | 指定 Connection 或全部合规 CLI Provider | 应用层显式 inspect/reconcile/repair，返回结构化状态 |

应用层必须提供只读 `inspect` 与可修复的 `reconcile/repair` 接口，供后续设置页调用；本阶段不要求制作扩展中心 UI。Host 对同一 Connection 的并发 reconciliation 做进程内合并，失败保留可重试诊断，不卸载或更新第三方 CLI，不执行登录，不访问真实 Provider 网络之外的最小 Hello。测试必须使用临时 HOME/TOWER_DATA_DIR、fake CLI/Adapter 和临时配置，禁止读写真实 Provider 配置目录。

## 包与组织规划

- 当前仓库先建立 workspace packages，区分公共 `ai-sdk`、私有 `ai-runtime`、官方 CLI Providers、公共 `agent-sdk` 和 `o-tower` 等 Agent 包。
- 公共 SDK 只包含契约、基类和无副作用纯工具；`where/which`、文件探测、进程启动、PTY 与环境清理属于私有 Host Runtime，通过 Context 提供能力。
- `o-tower` 等 Agent 是 `agent-sdk` 的消费者，不属于 `ai-sdk`。
- 第一版所有新包保持私有或仅作 workspace 引用，做到可独立发布但不实际发布。
- 契约验证稳定后再创建 GitHub Organization 和 npm Scope；建议按主应用、SDK、Providers、Agents、Registry 划分仓库，每个仓库内部可继续维护多个包。
- 组织名称、npm Scope、外部仓库创建和正式发布需要后续单独确认，不属于第一版实施授权。

## API Key 存储与交互

Tower 是本地个人助手，采用与 Cherry Studio 相同的本地可信模型：

- API Key 以明文存入本地 SQLite，不引入系统钥匙串、主密码或应用层加密。
- 设置页默认以密码样式隐藏完整 Key。
- 用户可以通过显示/隐藏按钮查看自己保存的完整 Key。
- 用户可以复制完整 Key；进入编辑状态时可以读取并修改原值。
- API Key 随 `tower.db` 进入完整备份，不做排除、脱敏或单独加密；完整恢复后连接应可直接继续使用。
- 备份页面最多使用静态说明提示备份包含连接凭据，不增加弹窗或重复确认流程。
- 完整 Key 不写入普通日志、错误信息、任务消息或连接测试报告。

API Key 与登录密码不同：Tower 调用上游模型时必须取回原值，因此不可使用只适合密码校验的单向哈希。

### 多 API Key 与健康检查

- 一个 API 连接支持多个 Key；每个 Key 有稳定 ID、可选标签、启用状态和独立测试状态。
- 每个启用 Key 都使用连接的默认模型执行最小生成测试，仅成功获取模型列表不算连接可用。
- Key 测试状态分为 `untested`、`ok`、`failed`，保存最后测试时间和脱敏错误，不保存或展示包含完整 Key 的诊断信息。
- 连接整体状态分为未测试、已连接、部分可用和不可用；至少一个启用 Key 测试成功时，连接可以被插槽选择。
- 运行时只在“已启用且测试成功”的 Key 中按 round-robin 轮询。
- 请求在产生任何内容、工具调用或其他副作用之前遇到 `401`、`403`、`429` 时，可以依次尝试下一个健康 Key。
- 流式输出开始或工具已经执行后不得换 Key 重试，避免重复内容、重复工具调用和重复计费。
- 首版不实现权重、余额判断、持久化限流调度或自动永久禁用；用户通过逐 Key 测试结果决定是否禁用异常 Key。

## 本地安全边界

- Tower 默认且正常运行模式只监听本机回环地址（`127.0.0.1` / `localhost`），不再以 `0.0.0.0` 作为默认监听地址。
- 本方案防范的是网络侧意外暴露和界面旁观，不承诺抵御已经取得当前系统用户权限的本机恶意进程。
- API Key 只授予实际执行对应 API 调用的服务端连接实现；CLI Adapter 与无关扩展不应获得全部 API Key。

## 已明确不做

- 不用 API 连接驱动交互式任务终端。
- 不由 Tower 管理 CLI 的 Base URL、Token 或登录状态配置。
- 不把 API Key 只存在环境变量中。
- 不对本地 API Key 增加不可查看限制。
- 不为备份实现密钥排除、独立加密或恢复后二次配置流程。

## 0.3.0 已实现

- 连接在上、五能力插槽在下的设置模型，以及显式有序回退和活动后锁定。
- 三个内置 CLI Provider、四类 API 协议、多 Key、模型发现/手动模型。
- 公共 CLI 契约源码、私有 Runtime、第三方插件应用层和 Tower 自有 Assistant 会话。
- API Key 本地可信存储、日志脱敏和生产默认回环监听。

## 后续

- 创建外部组织/npm scope 并正式发布 `@tower/ai-sdk` 或 Provider 包。
- 对外开放任意 API Adapter 插件。
- 评估更强的插件隔离和 Artifact 签名/审核机制。

上述后续项在 0.3.0 均未完成，不应在用户资料中写成已发布能力。
