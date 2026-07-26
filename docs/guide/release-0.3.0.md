---
title: 0.3.0 发布说明
description: AI Tools 0.3 用户能力、迁移、安全模型和已知限制
---

> 状态：本仓库已准备 0.3.0 本地产物；尚未 npm publish、创建 tag 或 GitHub Release。

集中验收结果与发布前人工检查见 [0.3.0 手工验收清单](/guide/acceptance-0.3.0)。当前结论为“可进入手工验收”，并非自动发布授权。

## 用户可见能力

- AI Tools 设置页采用“连接在上、Terminal/Summary/Dreaming/Analysis/Assistant 五插槽在下”。
- 内置 Claude Code、Codex CLI、Gemini CLI 的发现、Hello、模型、MCP/Hooks/Skills 状态；CLI 自己管理登录与网络凭据。
- OpenAI、OpenAI Compatible、Anthropic、Google API 连接，含自定义 base URL/header/query、多 Key 健康检查/round-robin、模型发现和手动模型。
- 五插槽使用显式主备顺序，只在首活动前回退；Terminal 会话固定 connection/model。
- Tower 自有 Assistant 多轮会话、旧 Claude 会话按需导入、附件、Tower 工具、SSE 和取消。
- 扩展中心的 CLI Provider Catalog 浏览、搜索、安装/更新、权限确认、禁用/卸载，以及独立的本地开发目录入口。
- 不进入内置注册表的 Qwen Code 社区 Provider 样板；依赖用户自行安装和登录 Qwen Code CLI。
- 生产 CLI 默认从全网卡改为 `127.0.0.1`；显式 `--host` 保持可用。

## 迁移与兼容

启动时先同步 Prisma schema，再按账本运行 `0009-api-connections` 到 `0013-assistant-sessions`；更旧 0.2 数据库也会顺序补齐 `0001` 到 `0008`。旧 `CliProfile`、`AgentConfig` 和 Claude transcript 保留，分别通过兼容读取、目标映射和按需复制导入继续使用。详见 [升级到 0.3.0](/guide/upgrade-0.3)。

## 安全模型

- 默认仅监听回环；显式远程 host 是用户主动扩大信任边界。
- API Key 明文存本地 SQLite，默认掩码但可显示/复制/编辑；完整数据库备份包含 Key，日志和错误脱敏。
- 插件是经完整性、静态清单、Schema、权限和受控进程检查的本地可信 Node.js 代码，不是 OS 沙箱。
- Runtime 不向插件暴露数据库、其他连接或 API Key，不用 shell 字符串启动 Provider。

## 已知限制

- `@tower/ai-sdk`、私有 Runtime 和官方 Provider 仍是 `private@0.1.0` workspace 包；本期未创建组织或发布独立 npm 包。
- API Adapter 插件不开放；Terminal 仍只接受 CLI。
- Assistant 临时附件缓存不进入完整归档；API 凭据、五能力目标、CLI 插件 registry/安装目录和 Assistant 会话由完整备份覆盖。
- 0.3 数据库不承诺回写兼容 0.2；降级必须恢复升级前备份。
- 官方 Catalog 仓库、GitHub Organization 和托管 URL 尚未获授权；建立前通过服务端 `TOWER_EXTENSION_CATALOG_URL` 或系统 Catalog URL 接入。
- 集中验收已在恢复原始 DM Sans、Geist、Geist Mono、JetBrains Mono 后，通过 Node 24 `--use-env-proxy` 和本机 `127.0.0.1:7897` 代理完成 standalone build 与 packaged smoke。无直连字体网络的构建环境仍需配置稳定代理或批准的字体缓存；不得通过移除或替换产品字体绕过。
