# Tower / o-tower 产品级可靠性与安全审查（2026-07-29）

> 本文保留整改前的审查基线。P0/P1 的当前关闭状态、真实飞书复测和仍未完成的 GA 项，见
> [`product-readiness-remediation-verification-2026-07-29.md`](./product-readiness-remediation-verification-2026-07-29.md)。

## 结论

当前版本适合：

- OWNER 在可信飞书群中使用；
- 已知、可信代码仓库的任务编排；
- 人在需要时能够介入的受控试运行。

当前版本不适合直接宣称：

- 可安全分享给互不信任的同事；
- 可安全评审任意陌生仓库；
- 可长期无人值守运行；
- 可绑定到局域网或公网后直接使用。

Workbench 的持久批次、ACK、原子完成、投递重试和诊断链路已经达到较高可靠度。整体产品仍有
4 个 P0 阻断项、5 个 P1 加固项。完成 P0 后可进入内部 Beta；完成 P1、故障演练和真人权限
黑盒测试后，才适合称为产品级。

## P0：上线阻断项

### P0-1 内部 HTTP API 只有 localhost 判断，没有调用方认证

`requireLocalhost` 只检查 Host / forwarded IP，没有验证共享密钥、签名、Origin 或 CSRF token。
所有本机进程都能调用 `/api/internal/**`；浏览器中的恶意网站还可以用
`Content-Type: text/plain` 向 localhost 发送跨源简单 POST。

生产只读验证：

```text
Origin: https://attacker.invalid
POST http://127.0.0.1:3000/api/internal/harness/gateway-runtime-health
Content-Type: text/plain

HTTP 200
```

同一保护方式还覆盖 gateway install、remote project、gateway completion、终端
start/input/stop、Workbench batch 等写接口。若 `TOWER_RUNTIME_HOST=0.0.0.0`，当前 guard
会允许任意 Host，风险进一步扩大。

修复要求：

1. OpenClaw/Hermes MCP 与 Tower 之间使用独立随机密钥；
2. 每个内部请求使用时间戳、nonce、method、path、body digest 做 HMAC；
3. Tower 校验时间窗口和 nonce 防重放；
4. 浏览器 Server Action 和内部 daemon API 分离；
5. 拒绝非预期 Origin，写接口只接受严格 Content-Type；
6. 远程 bind 无认证时启动失败，而不是降级为开放。

### P0-2 NON_OWNER 项目范围在没有 channel binding 时 fail-open

`projectAllowed` 在 binding 不存在或 `allowedProjectIds` 为空时返回 true；项目解析的 scope
也会退化为查询全部项目。

当前生产数据库只有 `harness.gatewayConfig`，不存在 `harness.channelBindings`。因此“起飞”
虽然是 OpenClaw 可信群，但 NON_OWNER 可以按名称询问 Tower 中任意工作区的项目，不符合
“只查询该群绑定工作区项目”的约定。

修复要求：

1. NON_OWNER 路由必须要求 channel binding 存在；
2. binding 缺失、workspace 缺失、allowed scope 为空时全部 fail-closed；
3. OpenClaw trusted channel 与 Tower channel binding 保存为同一事务/同一设置流程；
4. 把授权范围快照写进 GatewayInbound/GatewaySession；
5. `read_gateway_project_context` 再次校验授权快照；
6. ProductGroup 扩展出的兄弟项目也必须逐项重新校验范围；
7. 增加“无 binding”“空 allowedProjectIds”“跨工作区”“组内越权”测试。

### P0-3 REVIEW_ONLY 目前只是提示词，不是安全隔离

生产代码只在 Workbench prompt 中写“不得修改/运行脚本”。任务工具、PTY、文件系统、网络和
CLI 权限没有根据 `Project.accessMode` 收窄。仓库里的 README、知识文件、任务文本都属于不可信
内容，可能通过提示词注入诱导 OWNER/Workbench 创建写任务或执行命令。

修复要求：

1. REVIEW_ONLY 使用独立 executor/tool profile；
2. 禁止 create/update/delete task、终端启动/输入、文件写入、Git mutation、依赖安装；
3. 文件系统只读挂载到目标仓库，禁用仓库外读取；
4. 默认禁网，Git clone 与后续分析分离；
5. FULL_WORK 必须是独立的 OWNER 确认动作，PROVISION 不能一步直接进入 FULL_WORK；
6. 增加恶意 README/知识库 prompt-injection 测试和系统调用审计。

### P0-4 Tower 服务没有系统级监督，不满足无人值守

当前 Tower 进程树为：

```text
ChatGPT/Codex app-server -> pnpm start -> next-server
```

Tower 不在 launchd 中。Codex 桌面端退出、升级或崩溃时 Tower 会一起退出。OpenClaw 虽由
LaunchAgent 托管，但 Tower 本体没有 KeepAlive、崩溃重启、启动健康检查或版本回滚。

修复要求：

1. 提供 Tower LaunchAgent 安装/卸载/状态命令；
2. KeepAlive + RunAtLoad + 限速重启；
3. 原子版本目录和 current symlink，构建失败不覆盖当前版本；
4. 启动前迁移备份，启动失败自动回滚；
5. 健康检查覆盖 HTTP、WebSocket、DB、Workbench scheduler；
6. 对睡眠、断网、重启和 OpenClaw/Tower 启动顺序做故障演练。

## P1：内部 Beta 前应完成

### P1-1 权限撤销会残留

安装器只处理新策略中出现的平台。删除某个平台的最后一个 OWNER/可信群，或者把
`accessPolicy` 清空时，旧 tools、channel allowlist 和 binding 可能继续存在。卸载 profile
也只删除 agent，不清理其 bindings/channel 管理项。

需要记录 installer 管理过的平台和 binding，更新时做完整差集撤销；空策略必须显式写成
deny-all，并增加撤销/卸载测试。

### P1-2 生产依赖存在已公开高危漏洞

`pnpm audit --prod` 当前结果：

```text
54 vulnerabilities
4 low / 37 moderate / 12 high / 1 critical
```

直接生产依赖包括：

- `tar 7.5.13`：存在 critical 解压/解析 DoS；Tower 会处理备份和扩展 tarball；
- `ws 8.20.0`：存在 high 内存耗尽 DoS；
- MCP SDK 路径带入有漏洞的 Hono、node-server、path-to-regexp、fast-uri；
- Prisma 路径带入 effect、defu。

需要升级到修复版本、重新跑完整测试，并把 `pnpm audit --prod --audit-level high` 加入 release
gate。若某条 advisory 对当前运行方式不可达，必须形成可复核的例外记录，不能直接忽略。

### P1-3 缺少速率限制、并发配额和队列上限

可信群任何成员都可以持续 @机器人触发 LLM、知识检索和持久会话。当前 gateway route 没有
sender/chat rate limit、每日配额、最大 pending inbound 或最大 Workbench backlog。

需要按 sender、chat、project 分层限流；设置队列硬上限、熔断和 OWNER 告警。

### P1-4 敏感数据权限与保留策略不足

Tower DB 含 API key、消息正文、项目事实卡和任务数据，但当前：

- `~/.tower` 和 database 目录为 755；
- `tower.db` 为 644；
- GatewayInbound/GatewayDelivery 没有保留期清理；
- 事实卡、笔记和索引没有 secret 分类/回复前脱敏策略。

需要目录 700、数据库/备份 600；密钥使用系统 Keychain 或加密封装；消息审计数据设置保留期；
NON_OWNER 返回前执行敏感字段和 secret pattern 过滤。

### P1-5 远程项目接入缺少数据库级幂等和强确认

Project 的 `localPath`/repository identity 没有唯一约束，并发 PROVISION 可能重复登记。
PROVISION schema 允许直接传 `FULL_WORK`，没有第二阶段确认 token。

需要 provisioning request/idempotency 表、唯一规范化 repo identity、文件锁/数据库事务，以及
PROVISION 固定 REVIEW_ONLY、SET_MODE 单独确认。

## P2：正式发布前的运维加固

1. OpenClaw `gateway.controlUi.allowInsecureAuth=true` 应关闭。
2. 配置 `plugins.allow`，重新安装缺少 integrity metadata 的插件。
3. 补齐飞书 contact readonly scope，清除每条消息前的权限告警。
4. 当前最近完整备份停留在 2026-07-11；增加每日自动备份、保留策略和恢复演练。
5. 页面重建后旧客户端持续触发 `Failed to find Server Action`；增加版本检测和自动刷新提示。
6. 增加真人 NON_OWNER、陌生群、陌生私聊黑盒账号，不再只依赖配置结构单测。

## 已通过且可保留的设计

- GatewayInbound、WorkbenchEvent、GatewayDelivery 的稳定 dedup key；
- Workbench batch ACK/resolve 与崩溃恢复；
- Task DONE + FINAL_RESULT 原子事务；
- SENT_UNVERIFIED 禁止盲目自动重发；
- OWNER 的真实飞书引用回复验收；
- OpenClaw sender ID 来自 channel adapter，而不是消息正文；
- OWNER/NON_OWNER 工具表面在 OpenClaw 层分离；
- 诊断六阶段和按 inbound scoped recovery；
- 远程 clone 使用 `execFile` 参数数组，不走 shell，并限制单层目录名。

## 建议实施顺序

1. P0-2 NON_OWNER scope fail-closed；
2. P0-1 内部 API HMAC/Origin 防护；
3. P1-1 权限撤销完整性；
4. P0-3 REVIEW_ONLY 隔离 executor；
5. P0-4 launchd 与原子部署；
6. 升级高危依赖并加入 release gate；
7. 限流、权限数据脱敏、文件权限、自动备份；
8. 故障注入和真人多身份黑盒验收。

完成第 1–6 项后可评为“内部产品级 Beta”；完成全部 P1/P2 并连续运行与故障演练后，再评估
正式产品级。
