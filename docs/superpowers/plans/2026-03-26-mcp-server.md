# MCP Server + AGENTS.md + SKILL.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any AI agent operate ai-manager's workspaces, projects, and tasks via MCP protocol, plus provide AGENTS.md and SKILL.md documentation.

**Architecture:** stdio MCP Server using `@modelcontextprotocol/sdk`, importing Prisma client directly to share the SQLite database with the Next.js app. Each tool maps 1:1 to an existing server action.

**Tech Stack:** `@modelcontextprotocol/sdk`, Prisma Client, Zod, tsx

**Spec:** `docs/superpowers/specs/2026-03-26-ai-integration-design.md`

---

### Task 1: Install MCP SDK and add npm script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install MCP SDK**

```bash
pnpm add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Add mcp script to package.json**

Add to `scripts`:
```json
"mcp": "tsx src/mcp/index.ts"
```

- [ ] **Step 3: Verify install**

```bash
pnpm list @modelcontextprotocol/sdk
```
Expected: `@modelcontextprotocol/sdk` listed

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @modelcontextprotocol/sdk dependency and mcp script"
```

---

### Task 2: Create MCP database client with WAL mode

**Files:**
- Create: `src/mcp/db.ts`

- [ ] **Step 1: Create MCP-specific Prisma client**

This avoids depending on Next.js `@/*` path alias. Uses relative import and enables WAL mode.

```typescript
// src/mcp/db.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

export async function initDb() {
  await db.$connect();
  await db.$executeRawUnsafe("PRAGMA journal_mode=WAL");
  return db;
}

export { db };
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/db.ts
git commit -m "feat(mcp): add Prisma client with WAL mode for MCP server"
```

---

### Task 3: Create workspace tools

**Files:**
- Create: `src/mcp/tools/workspace-tools.ts`

Reference existing logic from: `src/actions/workspace-actions.ts`

- [ ] **Step 1: Implement workspace tools**

Implement 4 tools: `list_workspaces`, `create_workspace`, `update_workspace`, `delete_workspace`.

Each tool follows the pattern:
```typescript
import { z } from "zod";
import { db } from "../db";

export const workspaceTools = {
  list_workspaces: {
    description: "List all workspaces with project counts",
    schema: z.object({}),
    handler: async () => {
      const workspaces = await db.workspace.findMany({
        include: { projects: { select: { id: true } } },
        orderBy: { updatedAt: "desc" },
      });
      return workspaces.map((w) => ({
        ...w,
        projectCount: w.projects.length,
        projects: undefined,
      }));
    },
  },
  create_workspace: {
    description: "Create a new workspace",
    schema: z.object({
      name: z.string().describe("Workspace name"),
      description: z.string().optional().describe("Workspace description"),
    }),
    handler: async (args: { name: string; description?: string }) => {
      return db.workspace.create({ data: args });
    },
  },
  update_workspace: {
    description: "Update a workspace",
    schema: z.object({
      workspaceId: z.string().describe("Workspace ID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
    }),
    handler: async (args: { workspaceId: string; name?: string; description?: string }) => {
      const { workspaceId, ...data } = args;
      return db.workspace.update({ where: { id: workspaceId }, data });
    },
  },
  delete_workspace: {
    description: "Delete a workspace and all its projects/tasks (cascading)",
    schema: z.object({
      workspaceId: z.string().describe("Workspace ID to delete"),
    }),
    handler: async (args: { workspaceId: string }) => {
      await db.workspace.delete({ where: { id: args.workspaceId } });
      return { deleted: true };
    },
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/workspace-tools.ts
git commit -m "feat(mcp): add workspace tools (list/create/update/delete)"
```

---

### Task 4: Create project tools

**Files:**
- Create: `src/mcp/tools/project-tools.ts`

Reference existing logic from: `src/actions/workspace-actions.ts:56-91`

- [ ] **Step 1: Implement project tools**

4 tools: `list_projects`, `create_project`, `update_project`, `delete_project`.

Key: `create_project` derives `type` from `gitUrl` presence (matches existing `createProject` action at `workspace-actions.ts:69`).

```typescript
create_project: {
  description: "Create a new project in a workspace",
  schema: z.object({
    workspaceId: z.string(),
    name: z.string(),
    gitUrl: z.string().optional().describe("Git URL (sets type to GIT)"),
    localPath: z.string().optional().describe("Local file path"),
  }),
  handler: async (args) => {
    return db.project.create({
      data: {
        name: args.name,
        type: args.gitUrl ? "GIT" : "NORMAL",
        gitUrl: args.gitUrl,
        localPath: args.localPath,
        workspaceId: args.workspaceId,
      },
    });
  },
},
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/project-tools.ts
git commit -m "feat(mcp): add project tools (list/create/update/delete)"
```

---

### Task 5: Create task tools

**Files:**
- Create: `src/mcp/tools/task-tools.ts`

Reference: `src/actions/task-actions.ts`

- [ ] **Step 1: Implement task tools**

5 tools: `list_tasks`, `create_task`, `update_task`, `move_task`, `delete_task`.

Key details:
- `list_tasks` accepts optional `status` filter, returns tasks ordered by `[order asc, createdAt desc]`
- `create_task` accepts `labelIds` array, creates `TaskLabel` records after task creation
- `move_task` is a separate tool from `update_task` for clarity (only changes status)
- `priority` enum values: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `status` enum values: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `CANCELLED`

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/task-tools.ts
git commit -m "feat(mcp): add task tools (list/create/update/move/delete)"
```

---

### Task 6: Create label and search tools

**Files:**
- Create: `src/mcp/tools/label-tools.ts`
- Create: `src/mcp/tools/search-tools.ts`

Reference: `src/actions/label-actions.ts`, `src/actions/search-actions.ts`

- [ ] **Step 1: Implement label tools**

4 tools: `list_labels`, `create_label`, `delete_label`, `set_task_labels`.

`set_task_labels` replaces all labels (delete existing, create new), same as `label-actions.ts:43-53`.

- [ ] **Step 2: Implement search tool**

1 tool: `search` with `query` and optional `category` (`task` | `project` | `repository`).

Replicates logic from `search-actions.ts:15-91`.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/label-tools.ts src/mcp/tools/search-tools.ts
git commit -m "feat(mcp): add label tools and search tool"
```

---

### Task 7: Create MCP server and stdio entry point

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/index.ts`

- [ ] **Step 1: Create MCP server with tool registration**

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { workspaceTools } from "./tools/workspace-tools";
import { projectTools } from "./tools/project-tools";
import { taskTools } from "./tools/task-tools";
import { labelTools } from "./tools/label-tools";
import { searchTools } from "./tools/search-tools";

export function createServer() {
  const server = new McpServer({
    name: "ai-manager",
    version: "0.1.0",
  });

  // Register all tools from each module
  const allTools = { ...workspaceTools, ...projectTools, ...taskTools, ...labelTools, ...searchTools };

  for (const [name, tool] of Object.entries(allTools)) {
    server.tool(name, tool.description, tool.schema.shape, async (args) => {
      try {
        const result = await tool.handler(args as any);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    });
  }

  return server;
}
```

- [ ] **Step 2: Create stdio entry point**

```typescript
// src/mcp/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";
import { initDb } from "./db";

async function main() {
  await initDb();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP Server failed to start:", error);
  process.exit(1);
});
```

- [ ] **Step 3: Test MCP server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | pnpm mcp
```
Expected: JSON response with server capabilities

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts src/mcp/index.ts
git commit -m "feat(mcp): create MCP server with stdio transport and all tools"
```

---

### Task 8: Write AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Write AGENTS.md**

Replace the current single-line content with comprehensive project documentation for AI agents. Include:

1. Project overview (ai-manager: AI task management platform)
2. Data model (Workspace → Project → Task, Labels, TaskExecution, TaskMessage)
3. MCP Server configuration instructions
4. Available MCP tools table (all 18 tools with inputs/outputs)
5. Server actions reference (for AI working directly in codebase)
6. Constraints (cascade delete rules, enum values, ordering)
7. Keep the existing Next.js warning at the top

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: write comprehensive AGENTS.md for AI agent access"
```

---

### Task 9: Write SKILL.md

**Files:**
- Create: `skills/ai-manager/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Include:
1. Skill metadata (name, description, trigger conditions)
2. MCP Server setup instructions
3. Usage examples (create workspace → create project → create tasks → move tasks workflow)
4. Common workflow templates
5. Tool reference summary

- [ ] **Step 2: Commit**

```bash
git add skills/ai-manager/SKILL.md
git commit -m "docs: add SKILL.md for ai-manager operations"
```

---

### Task 10: Integration test

- [ ] **Step 1: Configure MCP in Claude Code settings for testing**

Add to Claude Code MCP config:
```json
{
  "mcpServers": {
    "ai-manager": {
      "command": "npx",
      "args": ["tsx", "<absolute-path>/src/mcp/index.ts"],
      "env": {
        "DATABASE_URL": "file:./prisma/dev.db"
      }
    }
  }
}
```

- [ ] **Step 2: Manual smoke test**

Test the following operations via Claude Code:
1. `list_workspaces` — should return existing workspaces
2. `create_workspace` with name "Test MCP" — should create and return
3. `list_projects` for the new workspace — should be empty
4. `create_task` in an existing project — should create
5. `search` for a known task title — should find it
6. `delete_workspace` — should cascade delete

- [ ] **Step 3: Final commit with any fixes**

```bash
git add -A
git commit -m "feat(mcp): MCP Server with full CRUD tools, AGENTS.md, and SKILL.md"
```
