# Search 模块

**Slug:** `search`

## 概述

全局搜索和代码搜索。全局搜索覆盖 Task、Project、Repository；代码搜索在项目 localPath 中执行。

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
