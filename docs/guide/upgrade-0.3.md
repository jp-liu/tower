---
title: 升级到 0.3.0
description: 0.2 数据迁移、兼容范围、备份和回滚说明
---

## 升级前

在 0.2 中先创建一份完整备份，并另外保留 `~/.tower` 的离线副本。0.3.0 不会自动导出或删除 API Key、CLI 凭据、插件配置或旧 Claude transcript。升级后的数据库不承诺能由 0.2 写入或读取；需要回滚时应恢复升级前备份，而不是让 0.2 打开已升级数据库。

生产 `tower` 从本版起默认绑定 `127.0.0.1`。需要原先的全网卡监听时显式传 `tower --host 0.0.0.0`；也可以指定明确的局域网地址。显式远程监听会扩大本地可信边界，请自行处理网络访问控制。

## 启动升级顺序

首次用 0.3.0 启动旧数据目录时按以下顺序执行：

1. 解析 `TOWER_DATA_DIR`（默认 `~/.tower`）并生成/检查 Prisma client。
2. 比较 schema hash；若变化，先清理可重建 FTS 表，再执行 Prisma `db push`，随后更新内置默认记录并重建 FTS。
3. 按文件名运行尚未记录在当前数据库 `AppliedMigration` 表中的一次性迁移；失败项不记账，下次启动重试，后续迁移不会越过失败项。
4. 所有迁移完成后启动 HTTP/WS 和内置 Provider 注册表。

从较早 0.2 升级时，runner 会依次补齐所有缺失项：

| ID | 作用 |
|---|---|
| `0001-insight-category` | 洞察笔记分类 |
| `0002-backfill-done-at` | 完成时间回填 |
| `0003-backfill-systemconfig-from-legacy-db` | 旧系统配置回填 |
| `0004-relocate-misplaced-assets` | 资产路径归位 |
| `0005-add-parent-task-id` | 父任务关系 |
| `0006-project-knowledge` | 项目知识字段/事实 |
| `0007-product-group` | 产品组 |
| `0008-add-label-description` | Label 描述 |
| `0009-api-connections` | 连接实例、API Key、模型与状态表；保留旧 Provider 行 |
| `0010-capability-targets` | 五插槽与有序目标；把旧 CLI 配置映射为显式目标 |
| `0011-cli-plugin-connections` | 第三方 CLI 命令、参数、环境、settings 与解析缓存 |
| `0012-terminal-execution-targets` | 终端执行的 connection/model 固定快照 |
| `0013-assistant-sessions` | Tower 自有 Assistant 会话、轮次和消息 |

`0009` 至 `0013` 是 AI Tools 0.3 新迁移。迁移使用幂等 SQL/数据转换，不会自动删除凭据。

## 旧配置与会话

- `CliProfile` 不删除，继续为内置 CLI 提供兼容 command/baseArgs/env。`0010` 为五个插槽创建目标；未配置时默认建立 Claude CLI 目标，但仍需 Hello 成功后才能使用。
- `AgentConfig` 和 Prompt 保留。原本的 Provider/mode/model 字段保留为兼容信息，运行时以 `AiCapabilityTarget` 的有序目标为准。无法映射的旧 API 配置标记 `legacy_api_unmapped`，需在设置页创建具体 API connection 后重新选槽。
- 旧 Terminal 执行没有目标快照；兼容解析只在能唯一映射到内置 CLI 时恢复。0.3 新执行都会保存固定快照。
- 旧 Claude Assistant transcript 不批量搬迁。列表最多显示 50 个未导入会话，首次打开/发送时只读转换并复制进 SQLite；失败不修改原文件，也不会自动删除原会话。

## 备份范围

| 数据 | 完整归档 |
|---|---|
| SQLite 数据库 | 包含；因此 API Key、自定义敏感 header/query、连接、插槽、Assistant 会话/消息都包含且为明文 |
| 项目资产 `storage/assets` | 包含 |
| Assistant persona/旧 transcript 所在 `assistant` | 包含 |
| 日志目录 | 包含；应用日志应已脱敏 |
| Assistant 临时附件 `storage/cache/assistant` | **不包含**；长期需要的文件应保存为项目资产 |
| CLI 插件 registry、安装/staging、插件 storage（`ai/`） | **不包含**；数据库连接配置会恢复，但插件需重新安装/确认 |
| CLI 自己的登录/token/base URL | 不属于 Tower 数据目录，也不由 Tower 备份 |
| Git worktree、用户仓库、截图、开发缓存 | 不包含 |

因为完整归档包含 SQLite 明文凭据，应按密钥材料保护备份文件。恢复不会要求重新输入 Key，也不会自动导出、擦除或轮换凭据。

## 回滚

0.3 不承诺向 0.2 写兼容。停止 0.3，移走升级后的数据目录，再恢复升级前 0.2 备份并安装原 0.2 版本。不要把 0.3 数据库交给 0.2 继续写入。
