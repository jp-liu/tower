---
title: Assets & Notes 模块
description: 项目资产管理（图片、文档上传）和项目笔记系统
---

**Slug:** `assets`

## 功能介绍

资产管理和笔记系统为项目提供文件存储和知识记录能力。

### 资产管理

- **文件上传**：支持上传图片和文档到项目，作为项目资料的一部分
- **画廊浏览**：资产页面以画廊形式展示所有上传的图片，支持灯箱预览大图
- **文档预览**：上传的文本文档可以直接在浏览器中预览内容
- **文件定位**：支持在系统文件管理器中快速定位资产文件

### 笔记系统

- **项目笔记**：在项目下创建和管理笔记，按分类组织
- **任务笔记**：为特定任务记录笔记
- **分类管理**：笔记支持分类筛选，方便组织和查找
- **Dreaming 洞察**：任务执行完成后的 Dreaming 洞察会自动保存为笔记，记录 AI 对任务执行过程的结构化分析

## 详细说明

### 资产存储

资产文件按项目 ID 组织存储，通过内部 API 和公开 API 两种路径提供文件访问服务。

### 笔记与任务关联

笔记可以独立存在于项目下，也可以关联到特定任务。任务完成后生成的 Dreaming 洞察通过 `insightNoteId` 字段关联到执行记录。

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
