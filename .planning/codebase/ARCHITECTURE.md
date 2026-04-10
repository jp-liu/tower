# Architecture

**Analysis Date:** 2026-03-26

## Pattern Overview

**Overall:** Next.js 16 full-stack monolith with server-side rendering, server actions for data mutations, and a standalone MCP server process for AI agent integration.

**Key Characteristics:**
- Server Components fetch data directly via Prisma; Client Components handle interactivity
- Server Actions (`"use server"`) serve as the primary data mutation layer (no REST API for CRUD)
- API Routes exist only for streaming/long-running operations (SSE for agent execution, filesystem browsing, git operations)
- Zustand stores manage ephemeral client-side state (board filters, drag state, execution streaming)
- MCP Server runs as a separate stdio process with its own Prisma client, exposing 18 CRUD tools
- Adapter pattern abstracts AI agent execution (currently only Claude Code local adapter)

## Layers

**Presentation Layer (Client Components):**
- Purpose: Interactive UI rendering, user input handling, optimistic updates
- Location: `src/components/`
- Contains: React client components using `"use client"` directive
- Depends on: Server Actions (via direct import), Zustand stores, UI primitives
- Used by: Page components in `src/app/`

**Page Layer (Server + Client Page Components):**
- Purpose: Route handling, data fetching, layout composition
- Location: `src/app/`
- Contains: Next.js page.tsx (Server Components that fetch data), *-client.tsx (Client Component wrappers)
- Depends on: Prisma `db`, Server Actions, Client Components
- Used by: Next.js router

**Server Actions Layer:**
- Purpose: All data mutations (create, update, delete) and some reads
- Location: `src/actions/`
- Contains: `"use server"` async functions that call Prisma and revalidate paths
- Depends on: `src/lib/db.ts` (Prisma client)
- Used by: Client Components (imported directly), Page Server Components

**API Routes Layer:**
- Purpose: Streaming responses, filesystem/git operations that cannot use server actions
- Location: `src/app/api/`
- Contains: Next.js Route Handlers (GET/POST)
- Depends on: Prisma `db`, Adapter registry, Process manager
- Used by: Client-side fetch calls

**Data Access Layer:**
- Purpose: Database operations via Prisma ORM
- Location: `src/lib/db.ts` (Next.js app), `src/mcp/db.ts` (MCP process)
- Contains: Singleton PrismaClient with global caching for dev hot-reload
- Depends on: `prisma/schema.prisma`, SQLite database
- Used by: Server Actions, API Routes, Page Server Components, MCP tools

**Adapter Layer:**
- Purpose: Abstract AI agent execution behind a pluggable interface
- Location: `src/lib/adapters/`
- Contains: Adapter type definitions, registry, process manager, Claude Code local adapter
- Depends on: Child process spawning, filesystem operations
- Used by: API Route `src/app/api/tasks/[taskId]/stream/route.ts`

**MCP Server Layer:**
- Purpose: Expose project data as MCP tools for external AI agents
- Location: `src/mcp/`
- Contains: MCP server setup, tool definitions mirroring server actions
- Depends on: Own Prisma client (`src/mcp/db.ts`), `@modelcontextprotocol/sdk`
- Used by: External AI agents via stdio transport

**Client State Layer:**
- Purpose: Ephemeral UI state management
- Location: `src/stores/`
- Contains: Zustand stores for board state and execution streaming state
- Depends on: Nothing (pure state)
- Used by: Client Components

## Data Flow

**Kanban Board Page Load:**

1. `src/app/workspaces/[workspaceId]/page.tsx` (Server Component) fetches workspace with projects, tasks, labels via Prisma
2. Passes serialized data as props to `BoardPageClient` (Client Component)
3. `BoardPageClient` renders `KanbanBoard`, `BoardFilters`, `BoardStats`, and conditionally `TaskDetailPanel` or `RepoSidebar`
4. Client-side filtering uses local state (no server round-trip)

**Task Status Change (Drag & Drop):**

1. User drags task card in `KanbanBoard` component
2. `@dnd-kit` fires `onDragEnd` event
3. Optimistic local state update via `setTasks` (immutable spread)
4. Calls `updateTaskStatus` server action (in `src/actions/task-actions.ts`)
5. Server action updates Prisma, calls `revalidatePath("/workspaces")`
6. `BoardPageClient` calls `router.refresh()` to re-fetch server data

**Agent Execution (SSE Streaming):**

1. Client POSTs to `/api/tasks/[taskId]/stream` with prompt, agent type, model
2. Route handler validates request, checks guards (no duplicate execution, concurrent limit)
3. Creates `TaskExecution` record in DB, registers process in `ProcessManager`
4. Gets adapter from registry (`src/lib/adapters/registry.ts`)
5. Calls `adapter.execute()` which spawns a child process (e.g., `claude` CLI)
6. Streams stdout/stderr chunks back as SSE events
7. On completion, persists result and assistant message to DB
8. Client abort signal kills the child process via `killProcess()`

**MCP Tool Invocation:**

1. External AI agent calls MCP tool via stdio
2. `src/mcp/server.ts` routes to tool handler
3. Tool handler (e.g., `src/mcp/tools/task-tools.ts`) queries/mutates via its own Prisma client
4. Returns JSON result wrapped in MCP content format

**State Management:**
- Server state: Prisma/SQLite is the source of truth; `revalidatePath` + `router.refresh()` keeps Server Components fresh
- Client state: Zustand stores (`board-store.ts`, `task-execution-store.ts`) hold transient UI state
- The `board-store` is defined but the main board page (`board-page-client.tsx`) uses local `useState` for filtering and task selection instead

## Key Abstractions

**AdapterModule:**
- Purpose: Pluggable AI agent execution interface
- Examples: `src/lib/adapters/claude-local/index.ts`
- Pattern: Strategy pattern — each adapter implements `execute()` and `testEnvironment()` from `src/lib/adapters/types.ts`
- Registry at `src/lib/adapters/registry.ts` maps type strings to adapter instances

**Server Actions:**
- Purpose: RPC-style data mutation functions callable from client components
- Examples: `src/actions/workspace-actions.ts`, `src/actions/task-actions.ts`, `src/actions/agent-actions.ts`
- Pattern: Each file groups related operations; all call `revalidatePath("/workspaces")` after mutations

**MCP Tools:**
- Purpose: Mirror server actions for external AI agent consumption
- Examples: `src/mcp/tools/workspace-tools.ts`, `src/mcp/tools/task-tools.ts`
- Pattern: Each tool defines a Zod schema, description, and handler; registered via `createServer()` loop in `src/mcp/server.ts`

**I18n System:**
- Purpose: Bilingual UI (Chinese/English)
- Examples: `src/lib/i18n.tsx`
- Pattern: React Context with `useI18n()` hook; all translations in a single file as a flat key-value object

## Entry Points

**Next.js App:**
- Location: `src/app/layout.tsx`
- Triggers: HTTP requests to the web app
- Responsibilities: Root layout, workspace data fetch, provider tree (TooltipProvider, I18nProvider, LayoutClient)

**Home Redirect:**
- Location: `src/app/page.tsx`
- Triggers: GET `/`
- Responsibilities: Redirects to `/workspaces`

**MCP Server:**
- Location: `src/mcp/index.ts`
- Triggers: `npx tsx src/mcp/index.ts` (stdio process)
- Responsibilities: Initialize separate Prisma client with WAL mode, create MCP server, connect stdio transport

**Agent Execution Stream:**
- Location: `src/app/api/tasks/[taskId]/stream/route.ts`
- Triggers: POST from client when user sends a message to execute
- Responsibilities: Validate, create execution record, spawn adapter process, stream SSE response

## Error Handling

**Strategy:** Mixed — server actions let errors propagate (no try-catch in most actions); API routes use try-catch with JSON error responses; client components show inline error messages.

**Patterns:**
- Server Actions: No explicit error handling; errors bubble to Next.js error boundaries
- API Routes: Try-catch with structured `{ error: string }` JSON responses and appropriate HTTP status codes (400, 404, 409, 503, 500)
- SSE Stream: Errors sent as `{ type: "error", content: string }` events; execution marked as FAILED in DB
- Client Components: Try-catch in callbacks with fallback UI messages (e.g., system message "Send failed, please retry")
- MCP Tools: Try-catch wrapper in `src/mcp/server.ts` returns `{ isError: true, content: [errorMessage] }`

## Cross-Cutting Concerns

**Logging:** Prisma query logging in development only (`src/lib/db.ts` with `log: ["query"]`). No application-level logging framework.

**Validation:** Zod schemas used in API route request bodies (`src/app/api/tasks/[taskId]/stream/route.ts`, `src/app/api/tasks/[taskId]/execute/route.ts`). Server actions have no input validation — they trust caller input.

**Authentication:** None. The application has no auth layer; all endpoints and actions are publicly accessible.

**Internationalization:** Client-side i18n via React Context (`src/lib/i18n.tsx`). Two locales: `zh` (default) and `en`. Locale persisted in localStorage.

**Path Revalidation:** All server actions call `revalidatePath("/workspaces")` after mutations, which is a broad revalidation strategy covering all workspace-related pages.

---

*Architecture analysis: 2026-03-26*
