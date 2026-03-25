# AI Manager - Project Management Kanban & Task Execution Platform

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based AI project management kanban board with integrated AI agent task execution, similar to CodeCraft Workflow Studio.

**Architecture:** Next.js 15 App Router fullstack application with PostgreSQL database. The frontend uses a kanban board with drag-and-drop task management. Each task can be assigned to an AI coding agent (e.g., Claude Code) for execution, with a real-time conversation panel. Server Actions handle mutations; Prisma ORM manages data persistence.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, Prisma + PostgreSQL, @dnd-kit (drag-and-drop), Zustand (client state), WebSocket (real-time agent communication)

---

## Scope Breakdown

This plan is divided into 4 phases, each producing working, testable software:

| Phase | What | Tasks |
|-------|------|-------|
| 1 | Project scaffolding + database schema + seed | 1-3 |
| 2 | Workspace & kanban board UI (core product) | 4-8 |
| 3 | Task execution panel + AI agent integration | 9-12 |
| 4 | Settings page + agent configuration | 13-15 |

---

## File Structure

```
ai-manager/
├── prisma/
│   ├── schema.prisma              # Database schema
│   ├── seed.ts                    # Seed data
│   └── migrations/                # Auto-generated
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout with sidebar
│   │   ├── page.tsx               # Redirect to /workspaces
│   │   ├── globals.css            # Tailwind imports + theme
│   │   ├── workspaces/
│   │   │   ├── page.tsx           # Workspace list / kanban board
│   │   │   └── [workspaceId]/
│   │   │       ├── page.tsx       # Board view for workspace
│   │   │       ├── tasks/
│   │   │       │   └── [taskId]/
│   │   │       │       └── page.tsx  # Task detail + execution panel
│   │   │       └── settings/
│   │   │           └── page.tsx   # Workspace settings
│   │   ├── settings/
│   │   │   └── page.tsx           # Global settings (AI Tools, Skills, Plugins)
│   │   └── api/
│   │       ├── workspaces/
│   │       │   └── route.ts       # Workspace CRUD
│   │       ├── tasks/
│   │       │   ├── route.ts       # Task CRUD
│   │       │   └── [taskId]/
│   │       │       ├── route.ts   # Single task ops
│   │       │       └── execute/
│   │       │           └── route.ts  # Start/stop AI execution
│   │       ├── repositories/
│   │       │   └── route.ts       # Repo management
│   │       └── agent-config/
│   │           └── route.ts       # Agent configuration CRUD
│   ├── components/
│   │   ├── ui/                    # shadcn/ui components (auto-generated)
│   │   ├── layout/
│   │   │   ├── app-sidebar.tsx    # Left sidebar with workspace nav
│   │   │   ├── top-bar.tsx        # Search bar + user menu + create button
│   │   │   └── sidebar-provider.tsx
│   │   ├── board/
│   │   │   ├── kanban-board.tsx   # Main board with columns
│   │   │   ├── board-column.tsx   # Single column (To Do, In Progress, etc.)
│   │   │   ├── task-card.tsx      # Draggable task card
│   │   │   ├── board-stats.tsx    # Stats bar (project overview, execution status, tips)
│   │   │   ├── board-filters.tsx  # Filter tabs (All, In Progress, In Review)
│   │   │   └── create-task-dialog.tsx  # New task creation dialog
│   │   ├── task/
│   │   │   ├── task-detail-panel.tsx   # Right-side task detail/execution panel
│   │   │   ├── task-conversation.tsx   # AI conversation messages
│   │   │   ├── task-message-input.tsx  # Chat input with send button
│   │   │   ├── task-metadata.tsx       # Branch, status, timestamps
│   │   │   └── task-file-changes.tsx   # File change indicator (+N -N)
│   │   ├── repository/
│   │   │   ├── repo-sidebar.tsx        # Right sidebar repo panel
│   │   │   ├── repo-selector.tsx       # Repository dropdown + branch picker
│   │   │   └── add-repo-panel.tsx      # Add repository panel
│   │   └── settings/
│   │       ├── ai-tools-config.tsx     # AI Tools configuration
│   │       ├── agent-selector.tsx      # Default agent dropdown
│   │       ├── agent-config-editor.tsx # JSON/form agent config editor
│   │       └── settings-nav.tsx        # Settings sidebar navigation
│   ├── lib/
│   │   ├── db.ts                  # Prisma client singleton
│   │   ├── utils.ts               # cn() and common utilities
│   │   └── constants.ts           # Board columns, task statuses, priorities
│   ├── stores/
│   │   ├── board-store.ts         # Zustand: board state, drag state, filters
│   │   └── task-execution-store.ts # Zustand: active task execution state
│   ├── types/
│   │   └── index.ts               # Shared TypeScript types
│   └── actions/
│       ├── workspace-actions.ts   # Server actions for workspaces
│       ├── task-actions.ts        # Server actions for tasks
│       └── agent-actions.ts       # Server actions for agent config
├── tests/
│   ├── unit/
│   │   ├── lib/
│   │   │   └── utils.test.ts
│   │   └── components/
│   │       ├── task-card.test.tsx
│   │       ├── board-column.test.tsx
│   │       └── board-stats.test.tsx
│   ├── integration/
│   │   ├── api/
│   │   │   ├── workspaces.test.ts
│   │   │   └── tasks.test.ts
│   │   └── actions/
│   │       ├── workspace-actions.test.ts
│   │       └── task-actions.test.ts
│   └── e2e/
│       ├── kanban-board.spec.ts
│       └── task-execution.spec.ts
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── .env.example
├── .env.local
├── .gitignore
└── README.md
```

---

## Phase 1: Project Scaffolding + Database

### Task 1: Initialize Next.js project with dependencies

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`
- Create: `.env.example`, `.env.local`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create Next.js project**

```bash
cd /Users/liujunping/project/i/ai-manager
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack
```

Accept defaults. This creates the base project structure.

- [ ] **Step 2: Install core dependencies**

```bash
pnpm add @prisma/client @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities zustand zod
pnpm add -D prisma vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/node
```

- [ ] **Step 3: Install shadcn/ui**

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button card dialog input label select separator sheet tabs badge dropdown-menu scroll-area textarea tooltip avatar
```

- [ ] **Step 4: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Create `tests/setup.ts`:
```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Create .env.example and .env.local**

Create `.env.example`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_manager"
```

Create `.env.local` with same content.

- [ ] **Step 6: Add scripts to package.json**

Add to `"scripts"`:
```json
{
  "db:generate": "prisma generate",
  "db:push": "prisma db push",
  "db:seed": "tsx prisma/seed.ts",
  "db:studio": "prisma studio",
  "test": "vitest",
  "test:run": "vitest run"
}
```

- [ ] **Step 7: Initialize git and commit**

```bash
git init
git add .
git commit -m "chore: initialize Next.js project with dependencies"
```

---

### Task 2: Define database schema

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`
- Create: `src/lib/constants.ts`
- Create: `src/types/index.ts`

- [ ] **Step 1: Write the Prisma schema**

Create `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Workspace {
  id          String   @id @default(cuid())
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  projects Project[]
}

model Project {
  id          String   @id @default(cuid())
  name        String
  description String?
  workspaceId String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace    Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  tasks        Task[]
  repositories Repository[]

  @@index([workspaceId])
}

model Task {
  id          String     @id @default(cuid())
  title       String
  description String?    @db.Text
  status      TaskStatus @default(TODO)
  priority    Priority   @default(MEDIUM)
  order       Int        @default(0)
  projectId   String
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  project      Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  executions   TaskExecution[]
  messages     TaskMessage[]

  @@index([projectId])
  @@index([status])
}

model TaskExecution {
  id        String          @id @default(cuid())
  taskId    String
  agent     String          @default("CLAUDE_CODE")
  config    String?         @default("DEFAULT")
  status    ExecutionStatus @default(PENDING)
  branch    String?
  startedAt DateTime?
  endedAt   DateTime?
  createdAt DateTime        @default(now())

  task     Task          @relation(fields: [taskId], references: [id], onDelete: Cascade)
  messages TaskMessage[]

  @@index([taskId])
}

model TaskMessage {
  id          String      @id @default(cuid())
  role        MessageRole
  content     String      @db.Text
  taskId      String
  executionId String?
  metadata    Json?
  createdAt   DateTime    @default(now())

  task      Task           @relation(fields: [taskId], references: [id], onDelete: Cascade)
  execution TaskExecution? @relation(fields: [executionId], references: [id])

  @@index([taskId])
  @@index([executionId])
}

model Repository {
  id        String  @id @default(cuid())
  name      String
  path      String
  branch    String  @default("main")
  projectId String
  createdAt DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

model AgentConfig {
  id          String  @id @default(cuid())
  agent       String
  configName  String
  appendPrompt String? @db.Text
  settings    Json?
  isDefault   Boolean @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([agent, configName])
}

enum TaskStatus {
  TODO
  IN_PROGRESS
  IN_REVIEW
  DONE
  CANCELLED
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum ExecutionStatus {
  PENDING
  RUNNING
  PAUSED
  COMPLETED
  FAILED
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
}
```

- [ ] **Step 2: Create Prisma client singleton**

Create `src/lib/db.ts`:
```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 3: Create constants and types**

Create `src/lib/constants.ts`:
```typescript
import type { TaskStatus } from "@prisma/client";

export const BOARD_COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "TODO", label: "To Do", color: "bg-gray-500" },
  { id: "IN_PROGRESS", label: "In Progress", color: "bg-blue-500" },
  { id: "IN_REVIEW", label: "In Review", color: "bg-orange-500" },
  { id: "DONE", label: "Done", color: "bg-green-500" },
  { id: "CANCELLED", label: "Cancelled", color: "bg-red-500" },
];

export const PRIORITY_CONFIG = {
  LOW: { label: "低优先级", color: "bg-gray-100 text-gray-600" },
  MEDIUM: { label: "中优先级", color: "bg-purple-100 text-purple-600" },
  HIGH: { label: "高优先级", color: "bg-orange-100 text-orange-600" },
  CRITICAL: { label: "紧急", color: "bg-red-100 text-red-600" },
} as const;

export const AGENTS = ["CLAUDE_CODE", "MINIMAX"] as const;
export type AgentType = (typeof AGENTS)[number];
```

Create `src/types/index.ts`:
```typescript
import type {
  Workspace,
  Project,
  Task,
  TaskExecution,
  TaskMessage,
  Repository,
  AgentConfig,
} from "@prisma/client";

export type TaskWithRelations = Task & {
  executions: TaskExecution[];
  messages: TaskMessage[];
};

export type ProjectWithRelations = Project & {
  tasks: Task[];
  repositories: Repository[];
};

export type WorkspaceWithProjects = Workspace & {
  projects: ProjectWithRelations[];
};

export type BoardColumn = {
  id: Task["status"];
  label: string;
  color: string;
  tasks: Task[];
};
```

- [ ] **Step 4: Generate Prisma client and push schema**

```bash
pnpm prisma generate
pnpm prisma db push
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: define database schema with Prisma"
```

---

### Task 3: Seed database and create utility helpers

**Files:**
- Create: `prisma/seed.ts`
- Create: `src/lib/utils.ts`
- Test: `tests/unit/lib/utils.test.ts`

- [ ] **Step 1: Write test for utils**

Create `tests/unit/lib/utils.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { cn, formatRelativeTime } from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("handles conditional classes", () => {
    expect(cn("px-2", false && "py-1", "text-sm")).toBe("px-2 text-sm");
  });

  it("resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("formatRelativeTime", () => {
  it("formats recent time as 'just now'", () => {
    const now = new Date();
    expect(formatRelativeTime(now)).toBe("刚刚");
  });

  it("formats minutes ago", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    expect(formatRelativeTime(tenMinutesAgo)).toBe("10分钟前");
  });

  it("formats hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoHoursAgo)).toBe("2小时前");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/unit/lib/utils.test.ts
```
Expected: FAIL — `formatRelativeTime` not found.

- [ ] **Step 3: Implement utils**

Create/update `src/lib/utils.ts`:
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 30) return `${days}天前`;
  return date.toLocaleDateString("zh-CN");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/unit/lib/utils.test.ts
```
Expected: PASS

- [ ] **Step 5: Create seed script**

Create `prisma/seed.ts`:
```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clean existing data
  await prisma.taskMessage.deleteMany();
  await prisma.taskExecution.deleteMany();
  await prisma.task.deleteMany();
  await prisma.repository.deleteMany();
  await prisma.project.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.agentConfig.deleteMany();

  // Create workspace
  const workspace = await prisma.workspace.create({
    data: {
      name: "测试",
      description: "测试工作空间",
    },
  });

  // Create project
  const project = await prisma.project.create({
    data: {
      name: "Test",
      description: "测试项目",
      workspaceId: workspace.id,
    },
  });

  // Create tasks
  await prisma.task.create({
    data: {
      title: "测试",
      description:
        "Improve code structure and maintainability without changing functionality.\n\n## Refactoring Checklist\n\n### 1. Identify Refactoring Targets\n- Review code for duplicated logic\n- Find functions exceeding 50 lines\n- Identify deeply nested conditionals",
      status: "IN_REVIEW",
      priority: "MEDIUM",
      order: 0,
      projectId: project.id,
    },
  });

  // Create default agent config
  await prisma.agentConfig.create({
    data: {
      agent: "CLAUDE_CODE",
      configName: "DEFAULT",
      isDefault: true,
      settings: {
        model: "claude-sonnet-4-6",
        maxTokens: 8096,
      },
    },
  });

  console.log("Seed completed successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 6: Run seed**

```bash
pnpm add -D tsx
pnpm db:seed
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add seed data and utility helpers"
```

---

## Phase 2: Workspace & Kanban Board UI

### Task 4: App layout with sidebar

**Files:**
- Create: `src/components/layout/app-sidebar.tsx`
- Create: `src/components/layout/top-bar.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Create globals.css with theme**

Update `src/app/globals.css` to include the purple-accent theme variables seen in the screenshots. The sidebar and primary accent are purple (#7c3aed range).

```css
@import "tailwindcss";

:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --primary: 263 70% 50%;
  --primary-foreground: 0 0% 100%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 263 70% 96%;
  --accent-foreground: 263 70% 50%;
  --border: 240 5.9% 90%;
  --sidebar-bg: 263 70% 50%;
  --sidebar-fg: 0 0% 100%;
}
```

- [ ] **Step 2: Create app-sidebar**

Create `src/components/layout/app-sidebar.tsx`:

The sidebar matches the screenshot:
- Logo "AI Manager" at top
- "工作空间" header with settings icon
- Tab buttons: 全部 / 需求 / 缺陷 / 任务
- Workspace list items showing name + time
- Footer: "查看归档 0"

Key implementation:
- Fetch workspaces from DB via server component or client fetch
- Active workspace highlighted
- Click workspace to navigate to `/workspaces/[id]`
- Purple gradient background matching screenshots

- [ ] **Step 3: Create top-bar**

Create `src/components/layout/top-bar.tsx`:

The top bar includes:
- Search input "Search tasks..." with search icon
- Settings gear icon
- "+ 新建项目" button (purple)
- User avatar with name

- [ ] **Step 4: Wire up root layout**

Update `src/app/layout.tsx`:
```typescript
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex h-screen overflow-hidden">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-auto bg-gray-50">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Create workspace landing page**

Create `src/app/page.tsx` that redirects to `/workspaces`.
Create `src/app/workspaces/page.tsx` that lists workspaces or redirects to first workspace.

- [ ] **Step 6: Verify layout renders**

```bash
pnpm dev
```
Open browser, verify sidebar + top bar render correctly.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add app layout with sidebar and top bar"
```

---

### Task 5: Board stats bar component

**Files:**
- Create: `src/components/board/board-stats.tsx`
- Test: `tests/unit/components/board-stats.test.tsx`

- [ ] **Step 1: Write test for BoardStats**

Create `tests/unit/components/board-stats.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardStats } from "@/components/board/board-stats";

describe("BoardStats", () => {
  it("renders task count", () => {
    render(<BoardStats totalTasks={5} runningTasks={2} tip="Test tip" />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders running task count", () => {
    render(<BoardStats totalTasks={5} runningTasks={2} tip="Test tip" />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders workflow tip", () => {
    render(<BoardStats totalTasks={5} runningTasks={2} tip="Test tip" />);
    expect(screen.getByText("Test tip")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/unit/components/board-stats.test.tsx
```

- [ ] **Step 3: Implement BoardStats**

Create `src/components/board/board-stats.tsx`:

Three stat cards in a row matching the screenshot:
1. 项目概览 — total task count
2. 执行状态 — running task count
3. 工作流提示 — tip text with title + description

Each card uses `<Card>` from shadcn with icon, title, big number/text, and description.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/unit/components/board-stats.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add board stats bar component"
```

---

### Task 6: Task card component

**Files:**
- Create: `src/components/board/task-card.tsx`
- Test: `tests/unit/components/task-card.test.tsx`

- [ ] **Step 1: Write test for TaskCard**

Create `tests/unit/components/task-card.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskCard } from "@/components/board/task-card";

const mockTask = {
  id: "1",
  title: "测试",
  description: "Improve code structure and maintainability",
  status: "IN_REVIEW" as const,
  priority: "MEDIUM" as const,
  order: 0,
  projectId: "p1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("TaskCard", () => {
  it("renders task title", () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.getByText("测试")).toBeInTheDocument();
  });

  it("renders truncated description", () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.getByText(/Improve code structure/)).toBeInTheDocument();
  });

  it("renders priority badge", () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.getByText("中优先级")).toBeInTheDocument();
  });

  it("renders action menu trigger", () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/unit/components/task-card.test.tsx
```

- [ ] **Step 3: Implement TaskCard**

Create `src/components/board/task-card.tsx`:

Card matches screenshot:
- White card with subtle border
- Title at top with "..." menu button (DropdownMenu)
- Description text (truncated to ~3 lines)
- Priority badge at bottom (colored, e.g., purple for 中优先级)
- Entire card is clickable to open task detail
- Uses `useSortable` from @dnd-kit for drag-and-drop

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/unit/components/task-card.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add task card component with priority badge"
```

---

### Task 7: Board column with drag-and-drop

**Files:**
- Create: `src/components/board/board-column.tsx`
- Create: `src/components/board/kanban-board.tsx`
- Create: `src/stores/board-store.ts`
- Test: `tests/unit/components/board-column.test.tsx`

- [ ] **Step 1: Write test for BoardColumn**

Create `tests/unit/components/board-column.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardColumn } from "@/components/board/board-column";

const mockTasks = [
  {
    id: "1",
    title: "Task 1",
    description: "Desc",
    status: "TODO" as const,
    priority: "MEDIUM" as const,
    order: 0,
    projectId: "p1",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe("BoardColumn", () => {
  it("renders column title", () => {
    render(
      <BoardColumn
        id="TODO"
        label="To Do"
        color="bg-gray-500"
        tasks={mockTasks}
      />
    );
    expect(screen.getByText("To Do")).toBeInTheDocument();
  });

  it("renders task cards", () => {
    render(
      <BoardColumn
        id="TODO"
        label="To Do"
        color="bg-gray-500"
        tasks={mockTasks}
      />
    );
    expect(screen.getByText("Task 1")).toBeInTheDocument();
  });

  it("renders add button", () => {
    render(
      <BoardColumn id="TODO" label="To Do" color="bg-gray-500" tasks={[]} />
    );
    expect(screen.getByRole("button", { name: /add/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/unit/components/board-column.test.tsx
```

- [ ] **Step 3: Create board store**

Create `src/stores/board-store.ts`:
```typescript
import { create } from "zustand";
import type { Task, TaskStatus } from "@prisma/client";

type FilterType = "ALL" | "IN_PROGRESS" | "IN_REVIEW";

interface BoardState {
  tasks: Task[];
  filter: FilterType;
  setTasks: (tasks: Task[]) => void;
  setFilter: (filter: FilterType) => void;
  moveTask: (taskId: string, newStatus: TaskStatus) => void;
  getFilteredTasks: () => Task[];
}

export const useBoardStore = create<BoardState>((set, get) => ({
  tasks: [],
  filter: "ALL",
  setTasks: (tasks) => set({ tasks }),
  setFilter: (filter) => set({ filter }),
  moveTask: (taskId, newStatus) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status: newStatus } : t
      ),
    })),
  getFilteredTasks: () => {
    const { tasks, filter } = get();
    if (filter === "ALL") return tasks;
    return tasks.filter((t) => t.status === filter);
  },
}));
```

- [ ] **Step 4: Implement BoardColumn**

Create `src/components/board/board-column.tsx`:

Column matches screenshot:
- Header with colored dot + column name + "+" button
- Uses `useDroppable` from @dnd-kit
- Renders `TaskCard` for each task
- Vertical scroll for overflow

- [ ] **Step 5: Implement KanbanBoard**

Create `src/components/board/kanban-board.tsx`:

Full board with:
- `DndContext` provider from @dnd-kit
- Maps `BOARD_COLUMNS` to `BoardColumn` components
- Handles `onDragEnd` to move tasks between columns
- Calls server action to persist status change

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm vitest run tests/unit/components/board-column.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add kanban board with drag-and-drop columns"
```

---

### Task 8: Board page with filters and task creation

**Files:**
- Create: `src/components/board/board-filters.tsx`
- Create: `src/components/board/create-task-dialog.tsx`
- Create: `src/actions/task-actions.ts`
- Create: `src/actions/workspace-actions.ts`
- Create: `src/app/workspaces/[workspaceId]/page.tsx`
- Create: `src/components/repository/repo-sidebar.tsx`
- Test: `tests/integration/actions/task-actions.test.ts`

- [ ] **Step 1: Write test for task server actions**

Create `tests/integration/actions/task-actions.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";

// Integration test - requires database
describe("Task Actions", () => {
  let projectId: string;

  beforeAll(async () => {
    const workspace = await db.workspace.create({
      data: { name: "Test WS" },
    });
    const project = await db.project.create({
      data: { name: "Test Project", workspaceId: workspace.id },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await db.task.deleteMany();
    await db.project.deleteMany();
    await db.workspace.deleteMany();
  });

  it("creates a task", async () => {
    const task = await db.task.create({
      data: {
        title: "Test Task",
        description: "Test description",
        projectId,
        status: "TODO",
        priority: "MEDIUM",
      },
    });
    expect(task.id).toBeDefined();
    expect(task.title).toBe("Test Task");
    expect(task.status).toBe("TODO");
  });

  it("updates task status", async () => {
    const task = await db.task.create({
      data: { title: "Move me", projectId, status: "TODO" },
    });
    const updated = await db.task.update({
      where: { id: task.id },
      data: { status: "IN_PROGRESS" },
    });
    expect(updated.status).toBe("IN_PROGRESS");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (DB integration)**

```bash
pnpm vitest run tests/integration/actions/task-actions.test.ts
```

- [ ] **Step 3: Create server actions for tasks**

Create `src/actions/task-actions.ts`:
```typescript
"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { TaskStatus, Priority } from "@prisma/client";

export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: Priority;
}) {
  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description,
      projectId: data.projectId,
      priority: data.priority ?? "MEDIUM",
      status: "TODO",
    },
  });
  revalidatePath("/workspaces");
  return task;
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const task = await db.task.update({
    where: { id: taskId },
    data: { status },
  });
  revalidatePath("/workspaces");
  return task;
}

export async function deleteTask(taskId: string) {
  await db.task.delete({ where: { id: taskId } });
  revalidatePath("/workspaces");
}
```

- [ ] **Step 4: Create board filters**

Create `src/components/board/board-filters.tsx`:

Tab-style filter buttons matching screenshot:
- 全部 (All) — default active, outlined style
- 执行中 (In Progress) — outlined
- 待评审 (In Review) — outlined
- "+ 新建任务" button on right

- [ ] **Step 5: Create task creation dialog**

Create `src/components/board/create-task-dialog.tsx`:

Dialog with:
- Title input
- Description textarea (markdown)
- Priority select (Low/Medium/High/Critical)
- Submit calls `createTask` server action

- [ ] **Step 6: Create the workspace board page**

Create `src/app/workspaces/[workspaceId]/page.tsx`:

Server component that:
1. Fetches workspace with projects and tasks from DB
2. Renders project selector dropdown (top-right)
3. Renders `BoardStats`
4. Renders `BoardFilters`
5. Renders `KanbanBoard` with tasks
6. Renders `RepoSidebar` on the right (collapsible)

Page header: "任务看板 — {projectName}"

- [ ] **Step 7: Create repo sidebar stub**

Create `src/components/repository/repo-sidebar.tsx`:

Right sidebar matching screenshot:
- "项目" dropdown
- "仓库" section with connected repo info (path + branch selector)
- "添加仓库" section with recent repos list
- "浏览磁盘上的仓库" and "在磁盘上创建新仓库" links

For now, this can be static/stub data. Full repo integration comes later.

- [ ] **Step 8: Verify full board renders**

```bash
pnpm dev
```
Navigate to workspace board, verify:
- Stats bar shows
- Kanban columns render
- Task cards appear
- Drag and drop works
- Filters toggle

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: complete kanban board with filters and task creation"
```

---

## Phase 3: Task Execution Panel + AI Agent Integration

### Task 9: Task detail panel UI

**Files:**
- Create: `src/components/task/task-detail-panel.tsx`
- Create: `src/components/task/task-metadata.tsx`
- Create: `src/components/task/task-conversation.tsx`
- Create: `src/components/task/task-message-input.tsx`
- Create: `src/components/task/task-file-changes.tsx`

- [ ] **Step 1: Create task metadata component**

Create `src/components/task/task-metadata.tsx`:

Displays (matching screenshot):
- Task title as heading
- Description: "聚焦当前任务的执行对话..."
- Tags: branch name (vk/fd2d-), "已有会话" badge, "更新于 3/24/2026" timestamp
- "返回任务列表" link at top-right

- [ ] **Step 2: Create task conversation component**

Create `src/components/task/task-conversation.tsx`:

Renders message list:
- System messages (info icon + text)
- User messages (right-aligned or labeled)
- Assistant messages (left-aligned, markdown rendered)
- Each message shows role icon + content + timestamp
- Auto-scroll to bottom

- [ ] **Step 3: Create task message input**

Create `src/components/task/task-message-input.tsx`:

Bottom input bar matching screenshot:
- "Continue working on this task..." placeholder
- "Default" mode dropdown on left
- Attachment icon button
- Tool icon button
- "发送" (Send) button on right
- File changes indicator: "0 个文件已更改 +0 -0"
- Agent indicator: "Claude Code" with dot

- [ ] **Step 4: Create task detail panel**

Create `src/components/task/task-detail-panel.tsx`:

Full right-side panel that composes:
- TaskMetadata at top
- TaskConversation (scrollable middle)
- TaskMessageInput at bottom
- Animated slide-in from right
- "任务对话" header with purple accent

- [ ] **Step 5: Wire into board page**

When a task card is clicked on the board, open TaskDetailPanel as a slide-over panel. The board narrows to make room (like screenshot 2).

- [ ] **Step 6: Verify panel renders**

```bash
pnpm dev
```
Click a task card, verify the detail panel slides in with conversation UI.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add task detail panel with conversation UI"
```

---

### Task 10: Task message server actions and API

**Files:**
- Create: `src/actions/agent-actions.ts`
- Create: `src/app/api/tasks/[taskId]/execute/route.ts`
- Test: `tests/integration/actions/task-messages.test.ts`

- [ ] **Step 1: Write test for message creation**

Create `tests/integration/actions/task-messages.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("Task Messages", () => {
  let taskId: string;

  beforeAll(async () => {
    const ws = await db.workspace.create({ data: { name: "Msg Test WS" } });
    const proj = await db.project.create({
      data: { name: "Msg Test Proj", workspaceId: ws.id },
    });
    const task = await db.task.create({
      data: { title: "Msg Task", projectId: proj.id },
    });
    taskId = task.id;
  });

  afterAll(async () => {
    await db.taskMessage.deleteMany();
    await db.taskExecution.deleteMany();
    await db.task.deleteMany();
    await db.project.deleteMany();
    await db.workspace.deleteMany();
  });

  it("creates a user message", async () => {
    const msg = await db.taskMessage.create({
      data: {
        role: "USER",
        content: "Please refactor this code",
        taskId,
      },
    });
    expect(msg.role).toBe("USER");
  });

  it("creates an execution and links messages", async () => {
    const exec = await db.taskExecution.create({
      data: {
        taskId,
        agent: "CLAUDE_CODE",
        status: "RUNNING",
      },
    });
    const msg = await db.taskMessage.create({
      data: {
        role: "ASSISTANT",
        content: "I'll analyze the code...",
        taskId,
        executionId: exec.id,
      },
    });
    expect(msg.executionId).toBe(exec.id);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm vitest run tests/integration/actions/task-messages.test.ts
```

- [ ] **Step 3: Create agent server actions**

Create `src/actions/agent-actions.ts`:
```typescript
"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function sendTaskMessage(taskId: string, content: string) {
  // Save user message
  const userMessage = await db.taskMessage.create({
    data: {
      role: "USER",
      content,
      taskId,
    },
  });

  // TODO: In Task 11, this will trigger AI agent execution
  // For now, create a mock assistant response
  const assistantMessage = await db.taskMessage.create({
    data: {
      role: "ASSISTANT",
      content: `Received your message: "${content}"\n\nI'll work on this task. (AI agent integration pending)`,
      taskId,
    },
  });

  revalidatePath(`/workspaces`);
  return { userMessage, assistantMessage };
}

export async function getTaskMessages(taskId: string) {
  return db.taskMessage.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  });
}

export async function startTaskExecution(taskId: string, agent: string = "CLAUDE_CODE") {
  const execution = await db.taskExecution.create({
    data: {
      taskId,
      agent,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  // Update task status to IN_PROGRESS
  await db.task.update({
    where: { id: taskId },
    data: { status: "IN_PROGRESS" },
  });

  revalidatePath("/workspaces");
  return execution;
}
```

- [ ] **Step 4: Create execution API route**

Create `src/app/api/tasks/[taskId]/execute/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const body = await request.json();

  const execution = await db.taskExecution.create({
    data: {
      taskId,
      agent: body.agent ?? "CLAUDE_CODE",
      config: body.config ?? "DEFAULT",
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  return NextResponse.json(execution);
}
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add task message and execution server actions"
```

---

### Task 11: AI agent process integration

**Files:**
- Create: `src/lib/agent-runner.ts`
- Create: `src/app/api/tasks/[taskId]/stream/route.ts`
- Create: `src/stores/task-execution-store.ts`

- [ ] **Step 1: Create agent runner abstraction**

Create `src/lib/agent-runner.ts`:

This module wraps the CLI execution of AI coding agents:

```typescript
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface AgentEvent {
  type: "message" | "file_change" | "status" | "error";
  content: string;
  metadata?: Record<string, unknown>;
}

export class AgentRunner extends EventEmitter {
  private process: ChildProcess | null = null;
  private agent: string;
  private cwd: string;

  constructor(agent: string, cwd: string) {
    super();
    this.agent = agent;
    this.cwd = cwd;
  }

  async start(prompt: string): Promise<void> {
    // For CLAUDE_CODE agent, spawn `claude` CLI in non-interactive mode
    if (this.agent === "CLAUDE_CODE") {
      this.process = spawn("claude", ["-p", prompt, "--output-format", "stream-json"], {
        cwd: this.cwd,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            this.emit("event", {
              type: "message",
              content: event.content ?? line,
              metadata: event,
            } satisfies AgentEvent);
          } catch {
            this.emit("event", {
              type: "message",
              content: line,
            } satisfies AgentEvent);
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        this.emit("event", {
          type: "error",
          content: data.toString(),
        } satisfies AgentEvent);
      });

      this.process.on("close", (code) => {
        this.emit("event", {
          type: "status",
          content: code === 0 ? "completed" : "failed",
        });
        this.emit("done", code);
      });
    }
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }
}
```

- [ ] **Step 2: Create SSE streaming endpoint**

Create `src/app/api/tasks/[taskId]/stream/route.ts`:

Server-Sent Events endpoint that:
1. Receives task ID and prompt
2. Creates/resumes a `TaskExecution`
3. Spawns `AgentRunner`
4. Streams events to client as SSE
5. Persists messages to DB as they arrive

- [ ] **Step 3: Create execution store**

Create `src/stores/task-execution-store.ts`:
```typescript
import { create } from "zustand";

interface ExecutionState {
  activeTaskId: string | null;
  isStreaming: boolean;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: Date;
  }>;
  fileChanges: { added: number; removed: number };
  setActiveTask: (taskId: string | null) => void;
  addMessage: (msg: ExecutionState["messages"][0]) => void;
  setStreaming: (streaming: boolean) => void;
  setFileChanges: (changes: { added: number; removed: number }) => void;
  reset: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  activeTaskId: null,
  isStreaming: false,
  messages: [],
  fileChanges: { added: 0, removed: 0 },
  setActiveTask: (taskId) => set({ activeTaskId: taskId }),
  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setFileChanges: (changes) => set({ fileChanges: changes }),
  reset: () =>
    set({
      activeTaskId: null,
      isStreaming: false,
      messages: [],
      fileChanges: { added: 0, removed: 0 },
    }),
}));
```

- [ ] **Step 4: Connect conversation UI to SSE stream**

Update `src/components/task/task-message-input.tsx` to:
1. On send, POST user message, then connect to SSE `/api/tasks/[taskId]/stream`
2. Stream assistant messages into execution store
3. Display real-time typing effect
4. Update file change counter from stream events

- [ ] **Step 5: Verify streaming works**

```bash
pnpm dev
```
Open a task, send a message. Verify:
- Message appears in conversation
- If `claude` CLI is available, AI responds via stream
- If not, mock response appears
- File change counter updates

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add AI agent runner with SSE streaming"
```

---

### Task 12: Task execution lifecycle management

**Files:**
- Modify: `src/components/board/task-card.tsx` — show execution status indicator
- Modify: `src/components/task/task-detail-panel.tsx` — add start/stop/pause controls
- Modify: `src/actions/agent-actions.ts` — add stop/pause actions
- Create: `src/components/task/task-action-buttons.tsx`

- [ ] **Step 1: Add execution action buttons**

Create `src/components/task/task-action-buttons.tsx`:

Right-side floating action buttons (matching screenshot 2):
- Share button
- Copy button
- Play/execute button
- Terminal button
- Settings button

These provide quick actions for task execution.

- [ ] **Step 2: Add execution controls to panel**

Update task detail panel header to include:
- "Start Execution" button (when no active execution)
- "Stop" button (when execution running)
- Execution status indicator (spinning for running)

- [ ] **Step 3: Add execution indicator to task cards**

Update `TaskCard` to show a small running indicator (animated dot) when the task has an active execution.

- [ ] **Step 4: Implement stop/pause server actions**

Add to `src/actions/agent-actions.ts`:
```typescript
export async function stopTaskExecution(executionId: string) {
  const execution = await db.taskExecution.update({
    where: { id: executionId },
    data: { status: "COMPLETED", endedAt: new Date() },
  });
  revalidatePath("/workspaces");
  return execution;
}
```

- [ ] **Step 5: Verify lifecycle**

Test full lifecycle:
1. Create task
2. Start execution
3. Send messages
4. Stop execution
5. Task moves to appropriate column

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add task execution lifecycle controls"
```

---

## Phase 4: Settings Page + Agent Configuration

### Task 13: Settings page layout and navigation

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/app/settings/layout.tsx`
- Create: `src/components/settings/settings-nav.tsx`

- [ ] **Step 1: Create settings navigation**

Create `src/components/settings/settings-nav.tsx`:

Left navigation matching screenshot 3:
- "配置" heading with "配置说明" subtitle
- AI Tools — "AI 工具配置与默认模型"
- Skills — "Skills 导入、启停与市场安装"
- Plugins — "Plugins 入口与 MCP 配置能力"

- [ ] **Step 2: Create settings layout**

Create `src/app/settings/layout.tsx`:
```typescript
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <SettingsNav />
      <div className="flex-1 overflow-auto p-8">
        {children}
      </div>
      <button className="absolute right-4 top-4 flex items-center gap-1 rounded border px-3 py-1 text-sm">
        X ESC
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create settings landing page**

Create `src/app/settings/page.tsx` — defaults to AI Tools section.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add settings page layout with navigation"
```

---

### Task 14: AI Tools configuration page

**Files:**
- Create: `src/components/settings/ai-tools-config.tsx`
- Create: `src/components/settings/agent-selector.tsx`
- Create: `src/components/settings/agent-config-editor.tsx`
- Create: `src/actions/agent-config-actions.ts`

- [ ] **Step 1: Write test for agent config actions**

Create `tests/integration/actions/agent-config.test.ts`:
```typescript
import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("AgentConfig", () => {
  afterAll(async () => {
    await db.agentConfig.deleteMany();
  });

  it("creates agent config", async () => {
    const config = await db.agentConfig.create({
      data: {
        agent: "CLAUDE_CODE",
        configName: "CUSTOM",
        appendPrompt: "Always use TypeScript",
        settings: { model: "claude-sonnet-4-6" },
      },
    });
    expect(config.agent).toBe("CLAUDE_CODE");
  });

  it("finds default config", async () => {
    await db.agentConfig.create({
      data: {
        agent: "CLAUDE_CODE",
        configName: "DEFAULT",
        isDefault: true,
      },
    });
    const defaultConfig = await db.agentConfig.findFirst({
      where: { agent: "CLAUDE_CODE", isDefault: true },
    });
    expect(defaultConfig).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm vitest run tests/integration/actions/agent-config.test.ts
```

- [ ] **Step 3: Create agent config server actions**

Create `src/actions/agent-config-actions.ts`:
```typescript
"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getAgentConfigs() {
  return db.agentConfig.findMany({ orderBy: { agent: "asc" } });
}

export async function getDefaultAgentConfig() {
  return db.agentConfig.findFirst({ where: { isDefault: true } });
}

export async function updateAgentConfig(
  id: string,
  data: { appendPrompt?: string; settings?: Record<string, unknown>; isDefault?: boolean }
) {
  const config = await db.agentConfig.update({
    where: { id },
    data,
  });
  revalidatePath("/settings");
  return config;
}

export async function createAgentConfig(data: {
  agent: string;
  configName: string;
  appendPrompt?: string;
  settings?: Record<string, unknown>;
}) {
  const config = await db.agentConfig.create({ data });
  revalidatePath("/settings");
  return config;
}

export async function deleteAgentConfig(id: string) {
  await db.agentConfig.delete({ where: { id } });
  revalidatePath("/settings");
}
```

- [ ] **Step 4: Create AI Tools config page**

Create `src/components/settings/ai-tools-config.tsx`:

Matches screenshot 3 layout:

Section 1: Header card with purple accent
- "AI Tools" label
- "编码代理配置" heading
- Description about configuring default executors
- Two feature cards: "默认执行器" and "配置一致性"

Section 2: 默认编码代理
- Agent dropdown (CLAUDE_CODE)
- Config dropdown (默认)
- Green success banner "检测到最近使用" when agent is found
- "保存" button

Section 3: 编码代理配置
- "配置编辑模式" toggle (form vs JSON)
- Agent dropdown + Config dropdown + Delete button
- "Append Prompt" textarea
- JSON editor (when toggle is on)

- [ ] **Step 5: Create agent selector**

Create `src/components/settings/agent-selector.tsx`:

Reusable agent+config dropdown pair:
```typescript
interface AgentSelectorProps {
  value: { agent: string; config: string };
  onChange: (value: { agent: string; config: string }) => void;
  configs: AgentConfig[];
}
```

- [ ] **Step 6: Create agent config editor**

Create `src/components/settings/agent-config-editor.tsx`:

Toggle between form mode and JSON mode:
- Form mode: individual fields for appendPrompt, settings
- JSON mode: raw JSON textarea
- "编辑 JSON" toggle switch

- [ ] **Step 7: Verify settings page**

```bash
pnpm dev
```
Navigate to settings, verify:
- Navigation works
- Agent selector shows CLAUDE_CODE
- Config can be edited
- Save persists to DB

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add AI Tools configuration page"
```

---

### Task 15: Final integration and polish

**Files:**
- Modify: various components for visual polish
- Create: `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx`
- Test: `tests/e2e/kanban-board.spec.ts`

- [ ] **Step 1: Create dedicated task page**

Create `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx`:

Full-page task view (alternative to panel):
- Task detail panel takes full width
- Breadcrumb: 任务看板 > {projectName} > {taskTitle}
- Full conversation history

- [ ] **Step 2: Add responsive behavior**

Ensure the layout works at different screen sizes:
- Sidebar collapses on narrow screens
- Board scrolls horizontally on small screens
- Task panel becomes full-screen on mobile

- [ ] **Step 3: Add keyboard shortcuts**

- `Esc` — close task panel / settings
- `N` — new task
- `?` — show shortcuts

- [ ] **Step 4: Write E2E test for kanban flow**

Create `tests/e2e/kanban-board.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test.describe("Kanban Board", () => {
  test("creates a new task and displays it", async ({ page }) => {
    await page.goto("/workspaces");
    // Click first workspace
    await page.click('[data-testid="workspace-item"]');
    // Click new task
    await page.click('text=新建任务');
    // Fill task form
    await page.fill('[data-testid="task-title"]', "E2E Test Task");
    await page.click('text=创建');
    // Verify task appears in To Do column
    await expect(page.locator('text=E2E Test Task')).toBeVisible();
  });

  test("opens task detail panel on click", async ({ page }) => {
    await page.goto("/workspaces");
    await page.click('[data-testid="workspace-item"]');
    await page.click('[data-testid="task-card"]');
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();
  });
});
```

- [ ] **Step 5: Install and configure Playwright**

```bash
pnpm add -D @playwright/test
npx playwright install chromium
```

Create `playwright.config.ts`:
```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "pnpm dev",
    port: 3000,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 6: Run E2E tests**

```bash
pnpm exec playwright test
```

- [ ] **Step 7: Visual polish pass**

Review and fix:
- Purple accent colors match screenshots
- Card shadows and hover states
- Sidebar active state styling
- Badge colors for priorities
- Transition animations for panel open/close

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "feat: final integration, E2E tests, and visual polish"
```

---

## Post-MVP Enhancements (Future)

These are NOT part of this plan but noted for future iteration:

1. **Real-time updates** — WebSocket for multi-user board sync
2. **Repository management** — Full git integration (clone, branch, browse)
3. **Skills marketplace** — Import/manage coding skills
4. **Plugins system** — MCP plugin configuration
5. **Multi-agent support** — Switch between Claude Code, MiniMax, etc.
6. **Task templates** — Pre-defined task types (refactor, feature, bugfix)
7. **Analytics dashboard** — Execution time, success rates, agent performance
8. **Team collaboration** — User management, permissions, assignments
