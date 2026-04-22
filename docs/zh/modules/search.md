---
title: Search 模块
description: 全局搜索和代码搜索，覆盖 Task、Project、Repository
---

**Slug:** `search`

## 功能介绍

全局搜索覆盖任务、项目、仓库、笔记、资产，基于 SQLite FTS5 全文搜索引擎实现快速检索。

主要能力：

- **全局搜索**：在搜索对话框中输入关键词，搜索所有任务标题/描述、项目名称、仓库信息、笔记内容、资产文件名
- **分类筛选**：支持按分类过滤搜索结果 — 任务、项目、仓库、笔记、资产
- **代码搜索**：在项目的 localPath 中搜索代码文件，支持关键词匹配和文件类型过滤
- **快捷键触发**：通过快捷键快速唤起搜索对话框

## 详细说明

### 全文搜索

基于 SQLite FTS5 实现，需要先运行 `pnpm db:init-fts` 初始化全文搜索索引。索引覆盖任务、项目、仓库等核心实体的文本字段。

### 代码搜索

项目内代码搜索在项目的 `localPath` 目录中执行，搜索代码文件内容，返回匹配的文件路径和代码片段。

## 文件清单

### Server Actions

| 文件 | 函数 | 说明 |
|------|------|------|
| `search-actions.ts` | `globalSearch(query, category?)` | 全局搜索 |
| `search-code-actions.ts` | 代码搜索 | 项目内代码搜索 |

### 核心库

| 文件 | 说明 |
|------|------|
| `lib/search.ts` | 全文搜索实现 |
| `lib/fts.ts` | SQLite FTS 处理 |

### 组件

- `src/components/layout/search-dialog.tsx` — 全局搜索对话框

### MCP Tools (`src/mcp/tools/search-tools.ts`)

- `search` — 按 query 搜索 task/project/repository

## 初始化

```bash
pnpm db:init-fts  # 创建全文搜索索引
```
