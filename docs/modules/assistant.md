---
title: Assistant 模块
description: Tower 自有会话、SSE、附件和工具执行
---

**Slug:** `assistant`

0.3.0 的 Assistant 使用 Tower 自有 SQLite 会话和消息作为恢复真源，不再绑定 Claude Agent SDK transcript。Assistant 插槽可以选择 CLI 或 API 连接，并共享 AI Tools 的显式回退规则。

## 会话与流式执行

- 多轮历史、会话标题以及 workspace/project/version 绑定存入 `AssistantSession`、`AssistantTurn`、`AssistantMessage`。
- SSE 依次发送文本、推理、工具调用、工具结果、用量、完成或脱敏错误事件；用户可以取消当前轮。
- 只在当前轮首个文本、推理、工具调用或副作用前尝试备用目标；活动开始后锁定 connection/model，避免重复内容、工具和计费。
- 图片与文本附件经过路径、数量、类型和大小校验。消息只保存受控附件元数据，不接受任意主机路径。
- Tower 工具由宿主提供并执行，模型只看到允许的工具定义；工具结果回到同一轮会话。

## 旧会话导入

最多列出 50 个旧 Claude Agent SDK 会话。第一次打开/发送时按需复制为 Tower 会话，并记录 `legacySource + legacyId` 防止重复导入；转换失败不会修改原 transcript。导入后，Tower 数据库消息是多 Provider 续聊的上下文来源。

## 主要位置

| 位置 | 职责 |
|---|---|
| `src/lib/ai/assistant-session-service.ts` | 会话、轮次、消息和附件校验 |
| `src/lib/ai/assistant-stream-executor.ts` | CLI/API 流、回退、取消和工具事件 |
| `src/lib/ai/assistant-legacy-adapter.ts` | 旧 Claude 会话只读导入 |
| `/api/internal/assistant/chat` | SSE 聊天 |
| `/api/internal/assistant/sessions` | 会话 CRUD/导入 |
| `/api/internal/assistant/attachments` | 附件上传 |

数据升级和备份范围见 [升级到 0.3.0](/guide/upgrade-0.3)。
