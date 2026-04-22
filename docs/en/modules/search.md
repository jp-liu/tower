---
title: Search
description: Global search and code search across tasks, projects, and repositories
---

# Search Module

**Slug:** `search`

## Overview

Global search covers tasks, projects, repositories, notes, and assets using SQLite FTS5 full-text search. Results can be filtered by category to narrow down what you are looking for. Tower also provides in-project code search that searches within a project's local directory path, making it easy to find specific code patterns without leaving the platform.

## Details

- **Full-text search**: Powered by SQLite FTS5 for fast, relevance-ranked results. The FTS index must be initialized with `pnpm db:init-fts` before first use.
- **Category filtering**: Search results can be scoped to a specific category — tasks, projects, or repositories — or left unfiltered to search across all categories.
- **Code search**: For projects with a `localPath`, you can search code files within that directory. This is useful for finding function definitions, variable usage, or specific patterns across the codebase.
- **Search dialog**: The global search dialog is accessible from the top bar, providing a unified entry point for all search functionality.

## File Reference

### Server Actions

| File | Function | Description |
|------|----------|-------------|
| `search-actions.ts` | `globalSearch(query, category?)` | Global search |
| `search-code-actions.ts` | Code search functions | In-project code search |

### Core Library

| File | Description |
|------|-------------|
| `lib/search.ts` | Full-text search implementation |
| `lib/fts.ts` | SQLite FTS handling |

### Components

- `src/components/layout/search-dialog.tsx` -- Global search dialog

### MCP Tools (`src/mcp/tools/search-tools.ts`)

- `search` -- Search tasks/projects/repositories by query

## Initialization

```bash
pnpm db:init-fts  # Create full-text search index
```
