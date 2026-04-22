---
title: Project
description: Project management with support for regular and Git-based projects
---

# Project Module

**Slug:** `project`

## Overview

Projects belong to workspaces and serve as containers for tasks. A project can link to a Git repository or a local directory. The project type (frontend, backend, etc.) affects which features are available — for example, preview is only available for frontend projects. When importing a local project, Tower auto-detects the Git remote URL. The "Generate Description" button uses AI to analyze the project's directory structure and produce a structured description automatically.

## Details

- **Two project types**: `NORMAL` and `GIT`. The type is automatically derived from whether a `gitUrl` is provided — you cannot set it manually.
- **Local import**: Point Tower at a local directory path. Git information (remote URL, current branch) is detected automatically.
- **AI-powered analysis**: The "Generate Description" button on the project detail/import page scans the project's `localPath` and generates a structured description covering tech stack, architecture, and key directories.
- **Repository linking**: Projects can have multiple associated repositories for broader context.

## Data Model

```
Project (id, name, alias?, description?, type, gitUrl?, localPath?)
  ├── Task[]
  └── Repository[]
```

- `type`: `NORMAL` | `GIT`, automatically derived from whether `gitUrl` is present; cannot be set manually
- `workspaceId`: FK to Workspace, cascade delete

## File Reference

### Server Actions (`src/actions/`)

| File | Function | Description |
|------|----------|-------------|
| `workspace-actions.ts` | `createProject`, `updateProject`, `deleteProject` | Project CRUD |
| `workspace-actions.ts` | `getProjectByLocalPath(path)` | Find by local path |
| `workspace-actions.ts` | `getRecentLocalProjects(limit?)` | Recent local projects |
| `project-actions.ts` | Project analysis functions | Project description generation, etc. |

### Components (`src/components/project/`)

| Component | Description |
|-----------|-------------|
| `create-project-dialog.tsx` | Create project dialog |
| `import-project-dialog.tsx` | Import project dialog |

### MCP Tools (`src/mcp/tools/project-tools.ts`)

- `list_projects` / `create_project` / `update_project` / `delete_project` / `identify_project`

## Constraints

- `type` field is read-only, determined by the presence of `gitUrl`
- Deleting a project cascades to all its Tasks
