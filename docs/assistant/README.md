# Assistant 模块

**Slug:** `assistant`

## 概述

AI 助手聊天系统，通过 Claude API 提供流式对话能力。支持多模态输入（文本+图片）。

## 文件清单

### Server Actions (`src/actions/assistant-actions.ts`)

会话管理和消息收发。

### API Routes

| 路由 | 说明 |
|------|------|
| `/api/internal/assistant/route.ts` | 助手管理 |
| `/api/internal/assistant/chat/route.ts` | 聊天消息（SSE 流式） |
| `/api/internal/assistant/images/route.ts` | 图片上传 |
| `/api/internal/assistant/sessions/route.ts` | 会话管理 |

### 组件 (`src/components/assistant/`)

| 组件 | 说明 |
|------|------|
| `assistant-chat.tsx` | 聊天主界面 |
| `assistant-panel.tsx` | 助手面板 |
| `image-preview.tsx` | 图片预览 |
| `chat-bubble.tsx` | 消息气泡 |

### Hooks (`src/hooks/`)

| Hook | 说明 |
|------|------|
| `use-assistant-chat.ts` | SSE 事件处理 |
| `use-image-upload.ts` | 图片上传 |
| `sse-event-reducer.ts` | SSE 流解析 |

### 核心库

| 文件 | 说明 |
|------|------|
| `lib/assistant-sessions.ts` | 会话管理 |
| `lib/assistant-message-converter.ts` | 消息格式转换 |
| `lib/claude-session.ts` | Claude API 会话 |
| `lib/build-multimodal-prompt.ts` | 多模态 prompt 构建 |
