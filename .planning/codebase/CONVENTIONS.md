# Coding Conventions

**Analysis Date:** 2026-03-26

## Naming Patterns

**Files:**
- Components: `kebab-case.tsx` (e.g., `task-card.tsx`, `board-column.tsx`, `kanban-board.tsx`)
- Server actions: `kebab-case.ts` with `-actions` suffix (e.g., `task-actions.ts`, `workspace-actions.ts`)
- Stores: `kebab-case.ts` with `-store` suffix (e.g., `board-store.ts`, `task-execution-store.ts`)
- Utilities: `kebab-case.ts` (e.g., `git-url.ts`, `process-manager.ts`)
- API routes: `route.ts` inside Next.js App Router directory structure
- UI primitives (shadcn): `kebab-case.tsx` (e.g., `button.tsx`, `dialog.tsx`)

**Functions:**
- Use `camelCase` for all functions
- Server actions: verb-noun pattern (`createTask`, `updateWorkspace`, `deleteProject`, `getProjectTasks`)
- Event handlers in components: `handle` prefix (`handleDragEnd`, `handleCreateTask`, `handleFilterChange`)
- Callback props: `on` prefix (`onTaskMove`, `onTaskClick`, `onEditTask`, `onDeleteTask`)

**Variables:**
- Use `camelCase` for all variables and state
- Boolean state: `is` prefix (`isStreaming`, `isPending`, `isDragging`)
- State setters: `set` prefix matching state name (`setTasks`, `setFilter`, `setSelectedTaskId`)

**Types/Interfaces:**
- Use `PascalCase`
- Component props: `ComponentNameProps` (e.g., `TaskCardProps`, `KanbanBoardProps`, `BoardStatsProps`)
- State interfaces: `StateName` + `State` (e.g., `BoardState`, `ExecutionState`)
- Extended Prisma types: descriptive suffix (`TaskWithRelations`, `ProjectWithRelations`, `WorkspaceWithProjects`)
- Inline interfaces are acceptable for server action parameters (see `src/actions/task-actions.ts`)

**Constants:**
- Use `UPPER_SNAKE_CASE` for constant objects and arrays (`BOARD_COLUMNS`, `PRIORITY_CONFIG`, `AGENTS`)
- Define in `src/lib/constants.ts`

**Enums (Prisma):**
- Use `UPPER_SNAKE_CASE` values (`TODO`, `IN_PROGRESS`, `CLAUDE_CODE`)

## Code Style

**Formatting:**
- No dedicated Prettier config file; relies on ESLint and editor defaults
- Double quotes for strings in most files (some shadcn UI files use no semicolons)
- Semicolons used consistently in application code
- 2-space indentation

**Linting:**
- ESLint 9 flat config at `eslint.config.mjs`
- Extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Minimal custom rules; relies on Next.js defaults
- `@typescript-eslint/no-explicit-any` suppressed with inline comments where needed

**TypeScript:**
- Strict mode enabled in `tsconfig.json`
- `noEmit: true` (Next.js handles compilation)
- Path alias: `@/*` maps to `./src/*`

## Import Organization

**Order (observed pattern):**
1. React/Next.js framework imports (`react`, `next/navigation`, `next/cache`)
2. Third-party libraries (`@dnd-kit/*`, `lucide-react`, `zustand`, `zod`)
3. Internal UI components (`@/components/ui/*`)
4. Internal application components (`@/components/board/*`, `@/components/task/*`)
5. Internal utilities and actions (`@/lib/*`, `@/actions/*`)
6. Type-only imports using `import type` syntax

**Path Aliases:**
- `@/*` → `./src/*` (the only alias; used consistently everywhere)

**Type Imports:**
- Use `import type` for type-only imports: `import type { Task, TaskStatus } from "@prisma/client"`
- Prisma types are re-exported from `@prisma/client` directly; extended types live in `src/types/index.ts`

## Component Patterns

**Server Components (default in App Router):**
- Page files (`page.tsx`) are async server components
- Fetch data directly using Prisma (`db.workspace.findUnique(...)`)
- Pass serialized data as props to client components
- Use `notFound()` from `next/navigation` for missing data
- Example: `src/app/workspaces/[workspaceId]/page.tsx`

**Client Components:**
- Marked with `"use client"` directive at top of file
- Naming convention for page-level client wrappers: `*-client.tsx` suffix (e.g., `board-page-client.tsx`, `archive-page-client.tsx`, `layout-client.tsx`)
- Handle all interactivity, state, and event handlers
- Call server actions directly for mutations (no API fetch wrappers)
- Use `useRouter().refresh()` wrapped in `useTransition` for server data revalidation after mutations

**Server Actions:**
- Files marked with `"use server"` directive
- Located in `src/actions/` directory
- Call `revalidatePath("/workspaces")` after mutations
- Accept plain objects as parameters (not FormData)
- Return Prisma model objects directly
- No try/catch — errors propagate to the client component

**UI Components (shadcn/base-nova):**
- Located in `src/components/ui/`
- Built on `@base-ui/react` primitives (NOT radix-ui)
- Use `class-variance-authority` (cva) for variant definitions
- Use `cn()` utility from `src/lib/utils.ts` for class merging
- Export both component and variants (e.g., `export { Button, buttonVariants }`)
- Style: `base-nova` with neutral base color and CSS variables

**Component Structure Pattern:**
```typescript
"use client";

import { /* hooks */ } from "react";
import { /* icons */ } from "lucide-react";
import { /* ui */ } from "@/components/ui/...";
import { useI18n } from "@/lib/i18n";

interface ComponentNameProps {
  // typed props
}

export function ComponentName({ prop1, prop2 }: ComponentNameProps) {
  const { t } = useI18n();
  // state, callbacks, effects
  return (/* JSX */);
}
```

## State Management

**Client State (Zustand):**
- Stores in `src/stores/` directory
- Named export pattern: `export const useXxxStore = create<XxxState>(...)`
- Interface-first: define state interface, then implement
- Immutable updates using spread operator in `set()` callbacks
- Stores: `useBoardStore` (`src/stores/board-store.ts`), `useExecutionStore` (`src/stores/task-execution-store.ts`)

**Server State:**
- No React Query or SWR — relies on Next.js server components + `router.refresh()`
- Data flows: Server Component fetches → passes as props to Client Component → client calls server action → calls `router.refresh()` to re-fetch
- Optimistic updates done via local `useState` in client components (see `KanbanBoard` drag handling)

**Form State:**
- Local `useState` per dialog/form (no form library like react-hook-form)
- Controlled inputs with explicit state variables

## Error Handling

**API Routes (`src/app/api/`):**
- Use try/catch with `NextResponse.json({ error: "message" }, { status: code })`
- Validate request body with Zod `safeParse`
- Return appropriate HTTP status codes (400, 404, 409, 500, 503)
- Example pattern from `src/app/api/tasks/[taskId]/execute/route.ts`:
```typescript
const parsed = bodySchema.safeParse(await request.json());
if (!parsed.success) {
  return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
}
```

**Server Actions (`src/actions/`):**
- No try/catch — errors propagate directly to calling client component
- No validation layer — trust the caller (client components)

**Client Components:**
- Minimal error handling; errors from server actions are not caught
- No error boundary usage observed
- No toast/notification system for error feedback

**MCP Server (`src/mcp/server.ts`):**
- Catches all errors in tool handlers
- Returns `{ isError: true, content: [{ type: "text", text: errorMessage }] }`

## Internationalization (i18n)

**Framework:** Custom React Context-based i18n at `src/lib/i18n.tsx`
- Supports `zh` (Chinese, default) and `en` (English)
- All translations inline in a single file as `const translations` object
- Access via `useI18n()` hook returning `{ locale, setLocale, t }`
- Translation keys use dot-notation: `"board.overview"`, `"task.create"`, `"sidebar.workspace"`
- Variable interpolation: `t("key", { name: "value" })` replaces `{name}` in template
- Locale persisted in `localStorage`

**Usage pattern:**
```typescript
const { t } = useI18n();
// In JSX:
<p>{t("board.overview")}</p>
```

**All user-facing strings MUST use `t()` calls, not hardcoded text.**

## Styling

**Framework:** Tailwind CSS v4 with `@tailwindcss/postcss`
- CSS variables for theming (dark mode default)
- Global styles in `src/app/globals.css`
- Utility-first approach; no CSS modules or styled-components
- Use `cn()` for conditional/merged classes

**Design tokens:**
- Colors: semantic tokens (`foreground`, `muted-foreground`, `border`, `card`, `accent`)
- Spacing: Tailwind defaults
- Border radius: CSS variable `--radius-md`
- Fonts: Geist Sans + Geist Mono (via `next/font/google`), DM Sans + JetBrains Mono (via Google Fonts link)

## Logging

**Framework:** `console` (no dedicated logging library)

**Patterns:**
- Prisma query logging enabled in development: `log: process.env.NODE_ENV === "development" ? ["query"] : []`
- No structured logging in application code

## Comments

**When to Comment:**
- Inline comments for non-obvious logic (e.g., `// Optimistic update`, `// Sync with server data when props change`)
- Section dividers in JSX using `{/* Section Name */}` comments
- ESLint disable comments with reason: `// eslint-disable-next-line @typescript-eslint/no-explicit-any`

**JSDoc/TSDoc:**
- Not used; interfaces serve as documentation

## Module Design

**Exports:**
- Named exports exclusively (no default exports except Next.js page components)
- Page components use `export default async function PageName`
- All other components, actions, and utilities use named exports

**Barrel Files:**
- `src/types/index.ts` serves as a type barrel
- No barrel files for components or actions — import directly from specific files

---

*Convention analysis: 2026-03-26*
