---
title: Assets & Notes
description: Project asset management and note-taking system
---

# Assets & Notes Module

**Slug:** `assets`

## Overview

The asset management system handles uploading images and documents with a gallery view for browsing and inline preview. Supported file types include common image formats and documents. Assets are scoped to projects and served via internal and public routes.

The notes system provides project-level and task-level note-taking with category management for organization. When a task execution completes, Tower's Dreaming capability automatically generates structured insights and saves them as notes, capturing what was accomplished and any patterns discovered during the run.

## Details

- **Asset gallery**: Browse uploaded assets in a grid layout with image lightbox for full-size preview and text preview for document files.
- **Upload management**: Upload images and documents through a drag-and-drop interface or file picker. Files are stored per project.
- **Notes with categories**: Notes can be organized by category. A category filter makes it easy to find specific notes across a project.
- **Dreaming insights**: After task execution completes, the AI generates structured insights (Dreaming) that are auto-saved as notes linked to the task. These capture patterns, decisions, and learnings from the execution.
- **MCP access**: External agents can manage both assets and notes through MCP tools.

## File Reference

### Server Actions

| File | Description |
|------|-------------|
| `asset-actions.ts` | Asset upload and management |
| `note-actions.ts` | Note CRUD |

### API Routes

| Route | Description |
|-------|-------------|
| `/api/internal/assets/[projectId]/[filename]` | Internal asset file serving |
| `/api/internal/assets/reveal` | Asset file location |
| `/api/files/assets/[projectId]/[filename]` | Public asset serving |

### Pages

| Route | Description |
|-------|-------------|
| `/workspaces/[id]/assets` | Asset gallery |
| `/workspaces/[id]/notes` | Note management |

### Components

**Assets** (`src/components/assets/`): `asset-upload`, `asset-list`, `image-lightbox`, `text-preview`

**Notes** (`src/components/notes/`): `note-editor`, `note-list`, `note-card`, `category-filter`

### MCP Tools

- `manage_assets` / `manage_notes` (via `note-asset-tools.ts`)
