# Assets & Notes 模块

**Slug:** `assets`

## 概述

项目资产管理（图片、文档上传）和项目笔记系统。

## 文件清单

### Server Actions

| 文件 | 说明 |
|------|------|
| `asset-actions.ts` | 资产上传和管理 |
| `note-actions.ts` | 笔记 CRUD |

### API Routes

| 路由 | 说明 |
|------|------|
| `/api/internal/assets/[projectId]/[filename]` | 内部资产文件服务 |
| `/api/internal/assets/reveal` | 资产文件定位 |
| `/api/files/assets/[projectId]/[filename]` | 公开资产服务 |

### 页面

| 路由 | 说明 |
|------|------|
| `/workspaces/[id]/assets` | 资产画廊 |
| `/workspaces/[id]/notes` | 笔记管理 |

### 组件

**资产** (`src/components/assets/`)：`asset-upload`, `asset-list`, `image-lightbox`, `text-preview`

**笔记** (`src/components/notes/`)：`note-editor`, `note-list`, `note-card`, `category-filter`

### MCP Tools

- `manage_assets` / `manage_notes`（via `note-asset-tools.ts`）
