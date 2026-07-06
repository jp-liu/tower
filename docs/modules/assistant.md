---
title: Assistant 模块
description: AI 助手聊天系统，通过 Claude API 提供流式对话能力
---

**Slug:** `assistant`

## 功能介绍

内置 AI 助手，通过 Claude Agent SDK 提供流式聊天能力。助手定位是「任务管理操作员」，可以通过 Tower MCP 工具帮你管理工作区、项目、任务。

主要能力：

- **流式对话**：基于 Claude Agent SDK 的 SSE 流式聊天，实时显示 AI 回复
- **任务管理操作**：助手可以通过 MCP 工具帮你创建工作区、项目、任务，查询状态，执行搜索等操作
- **附件上传**：支持多模态输入，上传图片等附件后 AI 可以理解内容并结合对话上下文回答
- **绑定范围**：助手面板顶部的绑定栏可为当前会话固定默认工作区 / 项目，MCP 操作默认落到该范围
- **会话恢复**：会话历史以磁盘上的 transcript 为准（localStorage 仅作索引），重新打开助手后按磁盘记录续接，避免重开后记录丢失
- **会话管理**：支持创建新会话、切换历史会话、重命名（需显式点击保存）
- **容错与降级**：resume 会话失效时自动降级为新会话并重试，吞掉重试残留的 Error 气泡；当一轮成功但模型无文字回复时补一个提示气泡，避免全静默；检测到 MCP 未连上会自动重新 spawn 一次；SSE 流断开不再崩溃，MCP 工具卡不重复渲染

## 详细说明

### 助手角色

助手通过 Tower MCP Server 获得工具能力，可以执行：
- 查看和管理工作区、项目
- 创建和更新任务，移动任务状态
- 搜索任务、项目、仓库
- 查看每日摘要和待办
- 管理标签

### 消息流

用户消息通过 SSE（Server-Sent Events）发送到后端，Claude Agent SDK 流式返回回复，前端实时渲染。

## 文件清单

### Server Actions (`src/actions/assistant-actions.ts`)

会话管理和消息收发。

### API Routes

| 路由 | 说明 |
|------|------|
| `/api/internal/assistant/route.ts` | 助手管理 |
| `/api/internal/assistant/chat/route.ts` | 聊天消息（SSE 流式） |
| `/api/internal/assistant/attachments/` | 附件上传 |
| `/api/internal/assistant/sessions/` | 会话管理 |

### 组件 (`src/components/assistant/`)

| 组件 | 说明 |
|------|------|
| `assistant-panel.tsx` | 助手面板容器 |
| `assistant-provider.tsx` | 助手上下文 Provider（会话 / 绑定范围状态） |
| `assistant-chat.tsx` | 聊天主界面 |
| `assistant-chat-bubble.tsx` | 消息气泡 |
| `assistant-markdown.tsx` | 回复 Markdown 渲染 |
| `assistant-binding-bar.tsx` | 绑定栏（默认工作区 / 项目） |
| `attachment-strip.tsx` | 附件预览条 |

### Hooks (`src/hooks/`)

| Hook | 说明 |
|------|------|
| `use-assistant-chat.ts` | SSE 事件处理 |
| `sse-event-reducer.ts` | SSE 流解析 |

### 核心库

| 文件 | 说明 |
|------|------|
| `lib/assistant-sessions.ts` | 会话管理 |
| `lib/assistant-constants.ts` | 助手常量 |
| `lib/assistant-session-title.ts` | 会话标题生成 |
| `lib/assistant-message-converter.ts` | 消息格式转换 |
| `lib/claude-session.ts` | Claude API 会话 |
| `lib/build-multimodal-prompt.ts` | 多模态 prompt 构建 |
