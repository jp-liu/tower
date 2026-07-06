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
- **Product group**: Group the multiple repos of one product (frontend / backend / trace static-knowledge / requirements) so the knowledge base searches them together.

### New / Import Project Dialog Options

Both dialogs (`create-project-dialog` / `import-project-dialog`) share the same fields:

- **Workspace**: shown as a dropdown when more than one workspace exists; defaults to the currently highlighted workspace. Switching workspace clears the selected group.
- **Group**: after a workspace is chosen, a `GroupSelect` dropdown offers "no group / existing group / + new group"; the new-group option creates and selects a group inline.
- **Project type**: `FRONTEND` / `BACKEND` (used as knowledge-base grouping semantics).
- **gitUrl / localPath**: create is Git-URL-first (auto-derives project name and local path, with a "Clone" button); import is folder-first (browse the folder, then the git remote is auto-detected).

> **Note**: The group is not created together with the project — `createProject` does **not** accept `groupId`. The dialog creates the project first, then calls `setProjectGroup(projectId, groupId)` to bind it.

## Data Model

```
ProductGroup (id, name, description?)          // per-workspace product group; name unique per workspace
  └── Project[]

Project (id, name, alias?, description?, type, gitUrl?, localPath?, groupId?, knowledgeDir?)
  ├── Task[]
  ├── Repository[]
  └── ProjectFact[] (key, value)               // structured fact cards; precise-match knowledge source
```

- `type`: `NORMAL` | `GIT`, automatically derived from whether `gitUrl` is present; cannot be set manually
- `workspaceId`: FK to Workspace, cascade delete
- `groupId?`: FK to ProductGroup, `onDelete: SetNull` — deleting a group unbinds its members without deleting them
- `knowledgeDir?`: overrides the in-repo knowledge dir (default `docs/知识库`)

### Product Group

A ProductGroup is a first-class entity under a workspace that groups the multiple repos of one product for **cross-repo knowledge search**.

- **Concept**: A product is often split into several repos (frontend / backend / trace static-knowledge / requirements). Once grouped, asking `ask_project_knowledge` about any member automatically pulls in all sibling projects of the same group.
- **Create**: pick "+ new group" in the group dropdown of the new/import dialog, or use MCP `create_product_group` / server action `createProductGroup`. Group name is unique per workspace.
- **Assign**: `setProjectGroup(projectId, groupId)` (UI) or MCP `update_project` with `groupId`; pass `null`/`""` to detach.
- **Same-workspace constraint**: all members of a group must belong to the same workspace. Because the knowledge layer aggregates purely by `groupId` (no workspace filter), a cross-workspace member would leak knowledge across workspaces — so assignment enforces same-workspace.

### Knowledge Base

`ask_project_knowledge` (`src/lib/knowledge.ts`) aggregates four sources; Tower only retrieves and aggregates — the calling LLM composes the final answer:

1. **In-repo knowledge files**: `<localPath>/<knowledgeDir>/*.md` (default `docs/知识库`, overridable via `knowledgeDir`, with a directory-escape guard)
2. **Fact cards `ProjectFact`**: machine-underivable project-level key-values (production/CICD paths, domains…), managed via `manage_project_facts`
3. **Versions and merge commits**: `Version` + each task's `mergeCommit`/`branch`/`changelog`
4. **DB notes**: `ProjectNote` (FTS full-text search)

If a project has a `groupId`, the search scope expands to all projects in the same group.

## File Reference

### Server Actions (`src/actions/`)

| File | Function | Description |
|------|----------|-------------|
| `workspace-actions.ts` | `createProject`, `updateProject`, `deleteProject` | Project CRUD (`createProject` does not accept `groupId`) |
| `workspace-actions.ts` | `getProjectByLocalPath(path)` | Find by local path |
| `workspace-actions.ts` | `getRecentLocalProjects(limit?)` | Recent local projects |
| `group-actions.ts` | `getProductGroups`, `createProductGroup`, `updateProductGroup`, `deleteProductGroup`, `setProjectGroup` | Product-group CRUD and project↔group assignment |
| `project-actions.ts` | Project analysis functions | Project description generation, etc. |

### Components (`src/components/project/`)

| Component | Description |
|-----------|-------------|
| `create-project-dialog.tsx` | Create project dialog (select workspace / group / project type) |
| `import-project-dialog.tsx` | Import project dialog (detect git remote, migrate path) |
| `group-select.tsx` | Group dropdown selector (no group / existing / inline new group) |

### MCP Tools (`src/mcp/tools/project-tools.ts`)

- `list_projects` / `create_project` / `update_project` / `delete_project` / `identify_project`
- `list_product_groups` / `create_product_group` — product groups
- `update_project` supports `groupId` (`""` detaches) and `knowledgeDir`

Knowledge-base tools live in `src/mcp/tools/knowledge-base-tools.ts`: `ask_project_knowledge` / `manage_project_facts`.

## Constraints

- `type` field is read-only, determined by the presence of `gitUrl`
- Deleting a project cascades to all its Tasks
- A group and its member projects must share one workspace; `createProject` does not accept `groupId` — bind separately with `setProjectGroup` after creation
- Deleting a group only unbinds members (`groupId = null`), it does not delete the projects
