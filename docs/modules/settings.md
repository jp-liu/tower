---
title: Settings 模块
description: 全局设置、AI Tools、CLI 插件与数据管理
---

**Slug:** `settings`

`/settings` 管理主题/语言、终端、系统、Prompt、Git 路径、扩展、备份和 AI Tools。AI Tools 采用清晰的上下两层：**连接在上，五个能力插槽在下**。

## AI Tools 连接

- Claude Code、Codex CLI、Gemini CLI：检测命令/版本，执行最小 Hello 测试，展示模型及 MCP/Hooks/Skills 状态。登录、token 和 base URL 由 CLI 自己管理。
- OpenAI、OpenAI Compatible、Anthropic、Google API：支持可编辑 base URL、自定义 header/query、多 Key 测试与 round-robin、模型发现和手动模型。
- base URL 只做 trim 和移除末尾 `/`，不会自动添加 `/v1`。
- API Key 在本地 SQLite 明文保存，默认掩码但可显示、复制和编辑；普通日志和错误脱敏。
- 第三方 CLI 插件通过 npm 精确版本或本地开发目录安装。用户审阅权限后才能启用，并可配置、禁用、重新启用或卸载。

## 能力插槽

Terminal、Summary、Dreaming、Analysis、Assistant 各自保存一个主目标和有序备用目标。只在首活动前回退，活动后锁定；Terminal 会话还会把 connection/model 固定到执行记录。

## 兼容配置

旧 `CliProfile` 和 `AgentConfig` 数据保留。`CliProfile` 仍为内置 CLI 提供兼容命令、参数和环境变量，但 AI Tools connection/slot 是 0.3 的主要配置入口。完整操作说明见 [AI Tools 0.3](/guide/ai-tools)。

## 其他设置

- Terminal：WebSocket 端口、空闲时间；生产监听 host 由 `tower --host` 控制。
- System：并发、上传、Git/搜索超时和任务归档期限。
- Prompt/Agent：全局或 workspace prompt、旧 Agent 附加配置。
- 数据管理：创建/恢复完整归档、存储位置和系统重置。凭据与附件范围见 [升级到 0.3.0](/guide/upgrade-0.3)。
- Tower Agent 扩展：见 [Tower Agent 能力扩展](/modules/agent-extension)。
