---
title: AI 模块
description: AI Tools 0.3 的连接、能力插槽、CLI 插件与 API Runtime
---

**Slug:** `ai`

## 0.3.0 状态

AI Tools 已从 Claude 专用调用重构为“连接 + 能力插槽”。设置页上半区管理 CLI/API 连接，下半区为 Terminal、Summary、Dreaming、Analysis、Assistant 五个使用场景选择有序目标。完整用户说明见 [AI Tools 0.3](/guide/ai-tools)；插件契约见 [CLI Provider 开发](/guide/cli-provider-sdk)。

| 插槽 | 用途 | 连接类型 |
|---|---|---|
| Terminal | 交互式任务终端 | 仅 CLI |
| Summary | 执行小总结 | CLI / API |
| Dreaming | 洞察与知识沉淀 | CLI / API |
| Analysis | 项目分析 | CLI / API |
| Assistant | Tower 自有多轮助手 | CLI / API |

内置 CLI Provider 为 Claude Code、Codex CLI、Gemini CLI；API Runtime 支持 OpenAI、OpenAI Compatible、Anthropic 和 Google。业务层通过 `connectionId + modelId` 引用目标，不再把 Provider 名称当连接实例。

## 执行语义

- 每个插槽只有用户显式配置的主目标与有序备用目标，不会临时挑选未声明 Provider。
- 只在首个内容、工具调用或副作用前切换健康 Key/备用目标；活动开始后锁定当前目标。
- Terminal 只在创建新会话前回退，成功创建后把 connection/model 快照写入 `TaskExecution`，恢复时固定使用原目标。
- API 多 Key 只从“启用且健康”的 Key 中 round-robin；`401`、`403`、`429` 只允许在活动前换 Key。
- 所有尝试记录目标、模型、耗时与脱敏错误码，不记录 prompt、Key 或敏感 header/query 值。

## 主要边界

| 层 | 位置 | 职责 |
|---|---|---|
| 公共 CLI 契约 | `packages/ai-sdk` | Manifest v1、Adapter、process spec、事件与配置 Schema 类型 |
| 私有 Host Runtime | `packages/ai-runtime` | 受控进程、API Adapter、回退、插件安装/校验、models.dev 快照 |
| 内置 Provider | `packages/ai-provider-*` | Claude/Codex/Gemini 参数、解析与 MCP/Hooks/Skills 集成 |
| 应用服务 | `src/lib/ai` | 连接 CRUD、能力解析、Assistant 会话、工具执行与审计 |

这些 workspace 包当前都保持 `private@0.1.0`。`0.1.0` 是内部包契约版本，不跟随 Tower 主应用 `0.3.0`；本期没有创建外部组织、发布 SDK/Provider 包或承诺独立安装。

## 安全模型

- CLI 自己负责登录、token 和 base URL；Tower 只负责发现、Hello 测试、启动和集成状态。
- API Key 明文存入本机 SQLite，界面默认掩码但可显示、复制和编辑；普通日志、错误与测试报告脱敏。
- 第三方 CLI 插件是本地可信 Node.js 代码，不是操作系统沙箱。安装前校验精确版本、完整性、静态 Manifest/Schema 和权限；禁用状态不加载。
- Adapter 返回结构化 `command/args/envPatch/initialInput`，宿主默认不启用 shell，并控制超时、取消和进程树回收。

## 后续

公共 npm 发布、外部组织/scope、任意 API Adapter 插件、插件操作系统级沙箱均为后续工作，0.3.0 未实现或未发布。架构依据保留在 `docs/ai/ai-tools-architecture-decisions.md`。
