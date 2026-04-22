---
title: Assistant
description: AI assistant chat system with streaming and multimodal support
---

# Assistant Module

**Slug:** `assistant`

## Overview

The built-in AI assistant is powered by the Claude Agent SDK with streaming chat support. It acts as a "task management operator" — rather than writing code directly, it manages workspaces, projects, and tasks through Tower's MCP tools. You can ask the assistant to create tasks, move them between statuses, search across projects, generate summaries, and more.

The assistant supports image uploads for multimodal conversations and maintains chat history that is automatically saved. Sessions can be resumed later to continue where you left off.

## Details

- **Streaming responses**: Chat responses arrive via Server-Sent Events (SSE), so you see the assistant's reply as it is generated in real time.
- **MCP tool integration**: The assistant has access to all Tower MCP tools, allowing it to perform actions like creating workspaces, listing tasks, or checking terminal output on your behalf.
- **Multimodal input**: Upload images alongside text messages. Images are processed and included in the conversation context for the AI to reference.
- **Session management**: Each conversation is a session with a unique ID. Sessions persist across page navigations and can be resumed from the session list.
- **Message format conversion**: Internal SDK message formats are converted to a UI-friendly format for display, handling tool calls, thinking blocks, and rich content.

## File Reference

### Server Actions (`src/actions/assistant-actions.ts`)

Session management and message handling.

### API Routes

| Route | Description |
|-------|-------------|
| `/api/internal/assistant/route.ts` | Assistant management |
| `/api/internal/assistant/chat/route.ts` | Chat messages (SSE streaming) |
| `/api/internal/assistant/images/route.ts` | Image upload |
| `/api/internal/assistant/sessions/route.ts` | Session management |

### Components (`src/components/assistant/`)

| Component | Description |
|-----------|-------------|
| `assistant-chat.tsx` | Main chat interface |
| `assistant-panel.tsx` | Assistant panel |
| `image-preview.tsx` | Image preview |
| `chat-bubble.tsx` | Message bubble |

### Hooks (`src/hooks/`)

| Hook | Description |
|------|-------------|
| `use-assistant-chat.ts` | SSE event handling |
| `use-image-upload.ts` | Image upload |
| `sse-event-reducer.ts` | SSE stream parsing |

### Core Library

| File | Description |
|------|-------------|
| `lib/assistant-sessions.ts` | Session management |
| `lib/assistant-message-converter.ts` | Message format conversion |
| `lib/claude-session.ts` | Claude API session |
| `lib/build-multimodal-prompt.ts` | Multimodal prompt construction |
