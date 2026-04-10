# Codebase Structure

**Analysis Date:** 2026-03-26

## Directory Layout

```
ai-manager/
├── prisma/                  # Database schema and seed
│   ├── schema.prisma        # Prisma schema (SQLite)
│   └── seed.ts              # Database seed script
├── public/                  # Static assets
├── src/
│   ├── actions/             # Next.js Server Actions (data mutation layer)
│   ├── app/                 # Next.js App Router pages and API routes
│   │   ├── api/             # REST/streaming API routes
│   │   ├── settings/        # Settings page
│   │   └── workspaces/      # Workspace pages (main UI)
│   ├── components/          # React components organized by domain
│   │   ├── board/           # Kanban board components
│   │   ├── layout/          # App shell (sidebar, topbar, layout)
│   │   ├── repository/      # Repository sidebar
│   │   ├── settings/        # Settings page components
│   │   ├── task/            # Task detail panel components
│   │   └── ui/              # shadcn/ui primitive components
│   ├── lib/                 # Shared utilities and core logic
│   │   └── adapters/        # AI agent adapter system
│   ├── mcp/                 # MCP Server (standalone process)
│   │   └── tools/           # MCP tool definitions
│   ├── stores/              # Zustand state stores
│   └── types/               # Shared TypeScript types
├── tests/                   # Test files (separate from source)
│   ├── e2e/                 # Playwright E2E tests
│   └── unit/                # Vitest unit tests
├── docs/                    # Documentation and specs
├── prompts/                 # AI prompt templates
├── skills/                  # AI skill definitions
├── AGENTS.md                # Agent reference (loaded by CLAUDE.md)
├── CLAUDE.md                # Claude Code project instructions
├── next.config.ts           # Next.js configuration
├── vitest.config.ts         # Vitest test configuration
├── playwright.config.ts     # Playwright E2E configuration
├── tsconfig.json            # TypeScript configuration
├── package.json             # Dependencies and scripts
└── pnpm-lock.yaml           # pnpm lockfile
```

## Directory Purposes

**`src/actions/`:**
- Purpose: Server-side data mutation and query functions
- Contains: `"use server"` modules, one per domain
- Key files:
  - `workspace-actions.ts`: Workspace and Project CRUD
  - `task-actions.ts`: Task CRUD, search, archive queries
  - `agent-actions.ts`: Task messages, execution start/stop
  - `label-actions.ts`: Label CRUD, task-label associations
  - `search-actions.ts`: Global search across entities
  - `agent-config-actions.ts`: Agent configuration CRUD
  - `prompt-actions.ts`: Agent prompt template CRUD

**`src/app/`:**
- Purpose: Next.js App Router — pages, layouts, API routes
- Contains: Server and Client page components, route handlers
- Key files:
  - `layout.tsx`: Root layout (fetches workspaces, wraps providers)
  - `page.tsx`: Root redirect to `/workspaces`
  - `globals.css`: Tailwind CSS and global styles

**`src/app/api/`:**
- Purpose: API routes for operations that cannot use server actions (streaming, filesystem)
- Contains: Route handlers (GET/POST)
- Key files:
  - `tasks/[taskId]/stream/route.ts`: SSE streaming for agent execution
  - `tasks/[taskId]/execute/route.ts`: Start execution (non-streaming)
  - `browse-fs/route.ts`: Filesystem directory browser
  - `git/route.ts`: Git operations (status, clone, checkout, branch)
  - `adapters/test/route.ts`: Test adapter environment

**`src/app/workspaces/`:**
- Purpose: Main workspace UI pages
- Contains: Workspace listing, board view, archive view
- Key files:
  - `page.tsx`: Workspace selection placeholder
  - `[workspaceId]/page.tsx`: Server Component — fetches workspace data, renders board
  - `[workspaceId]/board-page-client.tsx`: Client Component — board orchestrator with all state and handlers
  - `[workspaceId]/archive/page.tsx`: Server Component for archived tasks
  - `[workspaceId]/archive/archive-page-client.tsx`: Client Component for archive view

**`src/components/board/`:**
- Purpose: Kanban board UI components
- Contains: Board columns, task cards, filters, stats, dialogs
- Key files:
  - `kanban-board.tsx`: DnD context with drag-and-drop logic
  - `board-column.tsx`: Single Kanban column with droppable area
  - `task-card.tsx`: Individual task card (draggable)
  - `board-filters.tsx`: Filter bar (All / In Progress / In Review)
  - `board-stats.tsx`: Task count statistics display
  - `create-task-dialog.tsx`: Create/edit task dialog
  - `project-tabs.tsx`: Project tab switcher

**`src/components/layout/`:**
- Purpose: App shell and navigation
- Contains: Sidebar, top bar, search, folder browser
- Key files:
  - `layout-client.tsx`: Main layout wrapper (sidebar + topbar + content)
  - `app-sidebar.tsx`: Left sidebar with workspace list
  - `top-bar.tsx`: Top navigation bar with create project button
  - `search-dialog.tsx`: Global search dialog
  - `folder-browser-dialog.tsx`: Filesystem folder picker

**`src/components/task/`:**
- Purpose: Task detail panel and conversation UI
- Contains: Task metadata, conversation display, message input
- Key files:
  - `task-detail-panel.tsx`: Right panel showing task conversation
  - `task-conversation.tsx`: Message list display
  - `task-message-input.tsx`: Message input with send button
  - `task-metadata.tsx`: Task header with title, branch, status
  - `task-file-changes.tsx`: File change summary display

**`src/components/ui/`:**
- Purpose: shadcn/ui primitive components
- Contains: Button, Card, Dialog, Input, Select, Sheet, Tabs, etc.
- Note: Generated by shadcn CLI — do not manually edit

**`src/lib/`:**
- Purpose: Shared utilities and infrastructure code
- Key files:
  - `db.ts`: Singleton PrismaClient for Next.js app
  - `constants.ts`: Board columns config, priority config, agent types
  - `i18n.tsx`: Internationalization provider and translations
  - `utils.ts`: Utility functions (likely `cn()` for class merging)
  - `git-url.ts`: Git URL parsing utilities

**`src/lib/adapters/`:**
- Purpose: AI agent execution adapter system
- Contains: Adapter interface, registry, process management, Claude Code implementation
- Key files:
  - `types.ts`: `AdapterModule`, `ExecutionContext`, `ExecutionResult` interfaces
  - `registry.ts`: Adapter map and `getAdapter()` lookup
  - `process-manager.ts`: Concurrent execution limit, process kill support
  - `process-utils.ts`: Child process spawning utilities
  - `claude-local/index.ts`: Claude Code local adapter entry
  - `claude-local/execute.ts`: Claude CLI execution logic
  - `claude-local/parse.ts`: Output parsing for Claude CLI

**`src/mcp/`:**
- Purpose: Standalone MCP Server process for AI agent integration
- Contains: Server setup, tool definitions, separate DB client
- Key files:
  - `index.ts`: MCP process entry point
  - `server.ts`: MCP server creation and tool registration
  - `db.ts`: Separate PrismaClient with WAL pragma
  - `tools/workspace-tools.ts`: Workspace CRUD tools
  - `tools/project-tools.ts`: Project CRUD tools
  - `tools/task-tools.ts`: Task CRUD tools (5 tools)
  - `tools/label-tools.ts`: Label management tools
  - `tools/search-tools.ts`: Search tool

**`src/stores/`:**
- Purpose: Zustand client-side state stores
- Key files:
  - `board-store.ts`: Board tasks, filter, selected task (partially unused — board-page-client uses local state)
  - `task-execution-store.ts`: Streaming execution state (messages, file changes)

**`src/types/`:**
- Purpose: Shared TypeScript type definitions
- Key files:
  - `index.ts`: Composite types (`TaskWithRelations`, `ProjectWithRelations`, `WorkspaceWithProjects`, `BoardColumn`)

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root layout, provider tree, workspace data fetch
- `src/app/page.tsx`: Home page (redirects to /workspaces)
- `src/mcp/index.ts`: MCP server entry (run with `npx tsx src/mcp/index.ts`)

**Configuration:**
- `prisma/schema.prisma`: Database schema (10 models, 6 enums)
- `next.config.ts`: Next.js config (currently empty)
- `tsconfig.json`: TypeScript config with `@/` path alias
- `vitest.config.ts`: Vitest test configuration
- `playwright.config.ts`: Playwright E2E configuration
- `components.json`: shadcn/ui component configuration

**Core Logic:**
- `src/actions/task-actions.ts`: Task CRUD operations
- `src/actions/workspace-actions.ts`: Workspace and Project CRUD
- `src/app/api/tasks/[taskId]/stream/route.ts`: Agent execution streaming
- `src/lib/adapters/registry.ts`: Adapter registration and lookup
- `src/lib/adapters/claude-local/execute.ts`: Claude Code CLI execution

**Testing:**
- `tests/unit/`: Vitest unit tests
- `tests/e2e/`: Playwright E2E tests

## Naming Conventions

**Files:**
- Components: `kebab-case.tsx` (e.g., `kanban-board.tsx`, `task-card.tsx`)
- Server Actions: `kebab-case.ts` with `-actions` suffix (e.g., `task-actions.ts`)
- Stores: `kebab-case.ts` with `-store` suffix (e.g., `board-store.ts`)
- API Routes: `route.ts` inside directory-based route segments
- Types: `index.ts` barrel file in `src/types/`

**Directories:**
- Feature-based grouping under `src/components/` (e.g., `board/`, `task/`, `layout/`)
- Domain-based grouping for actions and MCP tools
- Nested route segments for API: `api/tasks/[taskId]/stream/`

**Exports:**
- Components: Named exports (e.g., `export function KanbanBoard`)
- Server Actions: Named async function exports (e.g., `export async function createTask`)
- Stores: Named hook exports (e.g., `export const useBoardStore`)

## Routing Structure

```
/                                    → Redirect to /workspaces
/workspaces                          → Workspace selection placeholder
/workspaces/[workspaceId]            → Kanban board (main view)
/workspaces/[workspaceId]/archive    → Archived tasks view
/settings                           → Settings page (AI tools config)

API Routes:
POST /api/tasks/[taskId]/execute     → Start task execution
POST /api/tasks/[taskId]/stream      → SSE streaming agent execution
GET  /api/browse-fs                  → Browse filesystem directories
GET  /api/git                        → Get git info for a path
POST /api/git                        → Git operations (clone, init, checkout, create-branch)
POST /api/adapters/test              → Test adapter environment
```

## Where to Add New Code

**New Feature (full-stack):**
- Server action: `src/actions/{domain}-actions.ts`
- Page: `src/app/{route}/page.tsx` (Server Component) + `{route}/{name}-client.tsx` (Client Component)
- Components: `src/components/{domain}/` directory
- Types: `src/types/index.ts`

**New Component:**
- Domain component: `src/components/{domain}/{component-name}.tsx`
- UI primitive: Run `npx shadcn add {component}` (generates in `src/components/ui/`)

**New API Route:**
- Create `src/app/api/{path}/route.ts`
- Use Zod for request body validation
- Return `NextResponse.json()` with appropriate status codes

**New Server Action:**
- Add to existing `src/actions/{domain}-actions.ts` or create new file
- Always add `"use server"` directive at top
- Always call `revalidatePath("/workspaces")` after mutations

**New AI Agent Adapter:**
- Create `src/lib/adapters/{adapter-name}/` directory
- Implement `AdapterModule` interface from `src/lib/adapters/types.ts`
- Register in `src/lib/adapters/registry.ts` adapters Map

**New MCP Tool:**
- Add to existing `src/mcp/tools/{domain}-tools.ts` or create new file
- Define Zod schema, description, and handler
- Import and spread into `allTools` in `src/mcp/server.ts`

**New Zustand Store:**
- Create `src/stores/{name}-store.ts`
- Export named hook (e.g., `export const useMyStore = create<MyState>(...)`)

**Utilities:**
- Shared helpers: `src/lib/{name}.ts`
- Constants: `src/lib/constants.ts`

## Special Directories

**`prisma/`:**
- Purpose: Database schema, migrations, seed data, SQLite database files
- Generated: `prisma/prisma/` contains generated Prisma client
- Committed: `schema.prisma` and `seed.ts` are committed; `dev.db*` files are not

**`src/components/ui/`:**
- Purpose: shadcn/ui generated primitive components
- Generated: Yes (via `npx shadcn add`)
- Committed: Yes
- Note: Do not manually edit — use shadcn CLI to add or update

**`.planning/`:**
- Purpose: GSD planning and codebase analysis documents
- Generated: By codebase mapping tools
- Committed: Yes

**`docs/superpowers/`:**
- Purpose: Feature specs and implementation plans
- Contains: `plans/` and `specs/` subdirectories

**`prompts/`:**
- Purpose: AI prompt templates
- Committed: Yes

**`skills/`:**
- Purpose: AI skill definitions for agent capabilities
- Contains: `ai-manager/` subdirectory with skill files

---

*Structure analysis: 2026-03-26*
