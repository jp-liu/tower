# Adapter Execution Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real AI agent execution for tasks — spawn CLI agents (Claude Code first), stream output in real-time, manage process lifecycle, and support prompt template CRUD.

**Architecture:** Extract Paperclip's adapter pattern (process-utils + claude-local parser) into `src/lib/adapters/`, wire into existing execute/stream API routes, add AgentPrompt CRUD for role-based prompts.

**Tech Stack:** Node.js child_process, Paperclip adapter-utils (extracted), Prisma, SSE streaming, Zod

**Spec:** `docs/superpowers/specs/2026-03-26-ai-integration-design.md`

**Source reference:** Paperclip adapter code at `/Users/liujunping/project/f/paperclip/packages/`

---

### Task 1: Prisma schema migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add AgentPrompt model, TaskExecution.sessionId, Task.promptId**

Add to `prisma/schema.prisma`:

```prisma
model AgentPrompt {
  id          String     @id @default(cuid())
  name        String
  description String?
  content     String
  isDefault   Boolean    @default(false)
  workspaceId String?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  workspace Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}
```

Add `sessionId String?` field to `TaskExecution` model (after `branch` field).

Add `promptId String?` field to `Task` model (after `order` field).

Add `prompts AgentPrompt[]` relation to `Workspace` model.

- [ ] **Step 2: Push schema changes**

```bash
pnpm db:push
```
Expected: schema synced, no errors

- [ ] **Step 3: Regenerate Prisma client**

```bash
pnpm db:generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add AgentPrompt model, Task.promptId, TaskExecution.sessionId"
```

---

### Task 2: Extract adapter types

**Files:**
- Create: `src/lib/adapters/types.ts`

Source reference: `/Users/liujunping/project/f/paperclip/packages/adapter-utils/src/types.ts` (243 lines)

- [ ] **Step 1: Create simplified adapter types**

Extract and simplify from Paperclip's types. Remove: `AdapterAgent.companyId`, `AdapterRuntime`, `HireApprovedPayload`, `onHireApproved`, `TranscriptEntry`, UI/CLI types. Keep core execution interfaces:

```typescript
// src/lib/adapters/types.ts

export interface ExecutionContext {
  runId: string;
  prompt: string;
  cwd: string;
  model?: string;
  sessionId?: string;
  instructionsFile?: string;
  env?: Record<string, string>;
  timeoutSec?: number;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}

export interface ExecutionResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  summary: string;
  sessionId?: string;
  usage?: UsageSummary;
  model?: string;
  costUsd?: number;
  errorMessage?: string;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface TestResult {
  ok: boolean;
  checks: TestCheck[];
}

export interface TestCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface AdapterModule {
  type: string;
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  testEnvironment(cwd: string): Promise<TestResult>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/adapters/types.ts
git commit -m "feat(adapters): add core adapter type definitions"
```

---

### Task 3: Extract process-utils

**Files:**
- Create: `src/lib/adapters/process-utils.ts`

Source reference: `/Users/liujunping/project/f/paperclip/packages/adapter-utils/src/server-utils.ts` (372 lines)

- [ ] **Step 1: Extract process spawning utilities**

Copy from Paperclip and clean up:
- Keep: `runChildProcess()`, `ensureCommandResolvable()`, `ensurePathInEnv()`, `resolveCommandPath()`, `resolveSpawnTarget()`, `appendWithCap()`, `parseObject()`, `asString()`, `asNumber()`
- Remove: `buildPaperclipEnv()` (Paperclip-specific env vars)
- Remove: `renderTemplate()` (we don't use Paperclip's template syntax)
- Adapt: remove `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` env stripping (lines 277-290 in original) — keep the function but simplify

Key function signature to preserve:
```typescript
export interface RunProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export async function runChildProcess(
  runId: string,
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutSec: number;
    graceSec: number;
    onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
    stdin?: string;
  },
): Promise<RunProcessResult>
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit src/lib/adapters/process-utils.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/adapters/process-utils.ts
git commit -m "feat(adapters): extract process-utils from Paperclip adapter-utils"
```

---

### Task 4: Extract Claude local adapter — parser

**Files:**
- Create: `src/lib/adapters/claude-local/parse.ts`

Source reference: `/Users/liujunping/project/f/paperclip/packages/adapters/claude-local/src/server/parse.ts` (180 lines)

- [ ] **Step 1: Copy and adapt Claude stream-json parser**

Copy the full file. Change imports from `@paperclipai/adapter-utils` to relative paths (`../types` and `../process-utils`).

Key exports to preserve:
- `parseClaudeStreamJson(stdout: string)` — parses JSON-lines output, returns `{ sessionId, model, usage, costUsd, result, assistantText, errorMessages }`
- `isClaudeUnknownSessionError(parsed)` — detects session resume failure
- `detectClaudeLoginRequired(input)` — detects auth needed

- [ ] **Step 2: Commit**

```bash
git add src/lib/adapters/claude-local/parse.ts
git commit -m "feat(adapters): extract Claude stream-json parser from Paperclip"
```

---

### Task 5: Extract Claude local adapter — execute and test

**Files:**
- Create: `src/lib/adapters/claude-local/execute.ts`
- Create: `src/lib/adapters/claude-local/test.ts`
- Create: `src/lib/adapters/claude-local/index.ts`

Source reference:
- `/Users/liujunping/project/f/paperclip/packages/adapters/claude-local/src/server/execute.ts`
- `/Users/liujunping/project/f/paperclip/packages/adapters/claude-local/src/server/test.ts`

- [ ] **Step 1: Implement simplified execute function**

Adapt from Paperclip's execute.ts. Remove:
- Paperclip workspace context handling (~20 lines)
- Paperclip env var injection (`buildPaperclipEnv`)
- Skills directory symlink logic
- `onHireApproved` hook

Keep core flow:
1. Build CLI args: `["--print", "-", "--output-format", "stream-json", "--verbose"]`
2. Add optional: `--model`, `--resume <sessionId>`, `--append-system-prompt-file <path>`
3. Call `runChildProcess()` with prompt as stdin
4. Parse output with `parseClaudeStreamJson()`
5. Handle session resume failure (retry without `--resume`)
6. Return `ExecutionResult`

```typescript
// src/lib/adapters/claude-local/execute.ts
import { runChildProcess } from "../process-utils";
import { parseClaudeStreamJson, isClaudeUnknownSessionError } from "./parse";
import type { ExecutionContext, ExecutionResult } from "../types";

export async function execute(ctx: ExecutionContext): Promise<ExecutionResult> {
  const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];

  if (ctx.model) args.push("--model", ctx.model);
  if (ctx.sessionId) args.push("--resume", ctx.sessionId);
  if (ctx.instructionsFile) args.push("--append-system-prompt-file", ctx.instructionsFile);

  const result = await runChildProcess(ctx.runId, "claude", args, {
    cwd: ctx.cwd,
    env: { ...process.env as Record<string, string>, ...(ctx.env ?? {}) },
    timeoutSec: ctx.timeoutSec ?? 0,
    graceSec: 20,
    onLog: ctx.onLog,
    stdin: ctx.prompt,
  });

  const parsed = parseClaudeStreamJson(result.stdout);

  // Retry without session if unknown session error
  if (ctx.sessionId && isClaudeUnknownSessionError(parsed)) {
    const retryArgs = args.filter((a, i) => a !== "--resume" && args[i - 1] !== "--resume");
    const retryResult = await runChildProcess(ctx.runId + "-retry", "claude", retryArgs, {
      cwd: ctx.cwd,
      env: { ...process.env as Record<string, string>, ...(ctx.env ?? {}) },
      timeoutSec: ctx.timeoutSec ?? 0,
      graceSec: 20,
      onLog: ctx.onLog,
      stdin: ctx.prompt,
    });
    const retryParsed = parseClaudeStreamJson(retryResult.stdout);
    return buildResult(retryResult, retryParsed);
  }

  return buildResult(result, parsed);
}

function buildResult(proc: any, parsed: any): ExecutionResult {
  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: proc.timedOut,
    summary: parsed.assistantText || parsed.result || "",
    sessionId: parsed.sessionId,
    usage: parsed.usage,
    model: parsed.model,
    costUsd: parsed.costUsd,
    errorMessage: parsed.errorMessages?.join("\n"),
  };
}
```

- [ ] **Step 2: Implement environment test**

Adapt from Paperclip's test.ts. Check:
1. `claude` command exists in PATH
2. `ANTHROPIC_API_KEY` env var present (or Claude logged in)
3. Run hello probe: `claude --print - --output-format stream-json` with stdin "Respond with just the word hello"

- [ ] **Step 3: Create adapter index**

```typescript
// src/lib/adapters/claude-local/index.ts
import { execute } from "./execute";
import { testEnvironment } from "./test";
import type { AdapterModule } from "../types";

export const claudeLocalAdapter: AdapterModule = {
  type: "claude_local",
  execute,
  testEnvironment,
};
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/adapters/claude-local/
git commit -m "feat(adapters): implement Claude local adapter (execute, parse, test)"
```

---

### Task 6: Create adapter registry and process manager

**Files:**
- Create: `src/lib/adapters/registry.ts`
- Create: `src/lib/adapters/process-manager.ts`

- [ ] **Step 1: Create adapter registry**

```typescript
// src/lib/adapters/registry.ts
import { claudeLocalAdapter } from "./claude-local";
import type { AdapterModule } from "./types";

const adapters = new Map<string, AdapterModule>([
  [claudeLocalAdapter.type, claudeLocalAdapter],
]);

export function getAdapter(type: string): AdapterModule {
  const adapter = adapters.get(type);
  if (!adapter) throw new Error(`Unknown adapter type: ${type}`);
  return adapter;
}

export function listAdapters(): string[] {
  return Array.from(adapters.keys());
}
```

- [ ] **Step 2: Create process lifecycle manager**

```typescript
// src/lib/adapters/process-manager.ts
import type { ChildProcess } from "child_process";

const MAX_CONCURRENT = 3;
const runningProcesses = new Map<string, ChildProcess>();

export function registerProcess(executionId: string, process: ChildProcess) {
  runningProcesses.set(executionId, process);
  process.on("exit", () => runningProcesses.delete(executionId));
}

export function killProcess(executionId: string): boolean {
  const proc = runningProcesses.get(executionId);
  if (proc && !proc.killed) {
    proc.kill("SIGTERM");
    runningProcesses.delete(executionId);
    return true;
  }
  return false;
}

export function getRunningCount(): number {
  return runningProcesses.size;
}

export function canStartExecution(): boolean {
  return runningProcesses.size < MAX_CONCURRENT;
}

export function isRunning(executionId: string): boolean {
  return runningProcesses.has(executionId);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/adapters/registry.ts src/lib/adapters/process-manager.ts
git commit -m "feat(adapters): add adapter registry and process lifecycle manager"
```

---

### Task 7: Prompt CRUD — server actions

**Files:**
- Create: `src/actions/prompt-actions.ts`

- [ ] **Step 1: Implement prompt server actions**

```typescript
"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getPrompts(workspaceId?: string) {
  return db.agentPrompt.findMany({
    where: workspaceId ? { OR: [{ workspaceId }, { workspaceId: null }] } : {},
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function getPromptById(id: string) {
  return db.agentPrompt.findUnique({ where: { id } });
}

export async function createPrompt(data: {
  name: string;
  description?: string;
  content: string;
  isDefault?: boolean;
  workspaceId?: string;
}) {
  const prompt = await db.agentPrompt.create({ data });
  revalidatePath("/workspaces");
  revalidatePath("/settings");
  return prompt;
}

export async function updatePrompt(
  id: string,
  data: { name?: string; description?: string; content?: string; isDefault?: boolean }
) {
  const prompt = await db.agentPrompt.update({ where: { id }, data });
  revalidatePath("/workspaces");
  revalidatePath("/settings");
  return prompt;
}

export async function deletePrompt(id: string) {
  await db.agentPrompt.delete({ where: { id } });
  revalidatePath("/workspaces");
  revalidatePath("/settings");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/prompt-actions.ts
git commit -m "feat: add AgentPrompt CRUD server actions"
```

---

### Task 8: Rewire stream API — real adapter execution

**Files:**
- Modify: `src/app/api/tasks/[taskId]/stream/route.ts`

This is the core integration — replace the mock SSE with real adapter execution.

- [ ] **Step 1: Rewrite stream route**

Replace the entire mock implementation. New flow:
1. Read task + project from DB (get cwd from `project.localPath`)
2. Check no RUNNING execution exists for this task
3. Check concurrent limit via `canStartExecution()`
4. Build prompt from task context + recent messages
5. If task has `promptId`, write prompt content to temp file for `--append-system-prompt-file`
6. Create TaskExecution record (status: RUNNING)
7. Call `adapter.execute()` with `onLog` callback that writes SSE events
8. On completion: update TaskExecution, save assistant message, update task status
9. Listen to `request.signal` for abort → kill process

Key code pattern:
```typescript
// Abort handling
request.signal.addEventListener("abort", () => {
  killProcess(execution.id);
});

// Prompt assembly
const messages = await db.taskMessage.findMany({
  where: { taskId },
  orderBy: { createdAt: "desc" },
  take: 10,
});
const prompt = [
  `Task: ${task.title}`,
  task.description ? `Description: ${task.description}` : "",
  messages.length > 0 ? `Recent conversation:\n${messages.reverse().map(m => `${m.role}: ${m.content}`).join("\n")}` : "",
  `User message: ${body.prompt}`,
].filter(Boolean).join("\n\n");
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tasks/[taskId]/stream/route.ts
git commit -m "feat: rewire stream API with real adapter execution and SSE"
```

---

### Task 9: Rewire execute API and fix sendTaskMessage

**Files:**
- Modify: `src/app/api/tasks/[taskId]/execute/route.ts`
- Modify: `src/actions/agent-actions.ts`

- [ ] **Step 1: Update execute route**

Add validation:
- Check task exists and has a project with `localPath`
- Check no RUNNING execution for this task
- Check `canStartExecution()`
- Get last successful execution's `sessionId` for resume
- Create TaskExecution with sessionId reference

- [ ] **Step 2: Remove mock from sendTaskMessage**

In `src/actions/agent-actions.ts`, remove the mock assistant response (lines 15-23). Keep only user message creation:

```typescript
export async function sendTaskMessage(taskId: string, content: string) {
  const userMessage = await db.taskMessage.create({
    data: { role: "USER", content, taskId },
  });
  revalidatePath("/workspaces");
  return { userMessage };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tasks/[taskId]/execute/route.ts src/actions/agent-actions.ts
git commit -m "feat: rewire execute API, remove mock from sendTaskMessage"
```

---

### Task 10: Add environment test API

**Files:**
- Create: `src/app/api/adapters/test/route.ts`

- [ ] **Step 1: Create test endpoint**

```typescript
// src/app/api/adapters/test/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdapter, listAdapters } from "@/lib/adapters/registry";

export async function POST(request: NextRequest) {
  const { adapterType, cwd } = await request.json();
  try {
    const adapter = getAdapter(adapterType);
    const result = await adapter.testEnvironment(cwd || process.cwd());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ adapters: listAdapters() });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/adapters/test/route.ts
git commit -m "feat: add adapter environment test API endpoint"
```

---

### Task 11: Create default prompt templates

**Files:**
- Create: `prompts/frontend-developer.md`
- Create: `prompts/backend-developer.md`
- Create: `prompts/product-manager.md`
- Create: `prompts/code-reviewer.md`

- [ ] **Step 1: Write prompt templates**

Each template defines the AI agent's role, responsibilities, and constraints. Example structure:

```markdown
# Frontend Developer

You are a senior frontend developer working on this project.

## Responsibilities
- Implement UI components using React and Next.js
- Write clean, accessible, and responsive code
- Follow existing project patterns and conventions

## Tech Stack
- React 19, Next.js 16, TypeScript
- Tailwind CSS 4, shadcn UI components
- Zustand for state management

## Constraints
- Follow existing code style and file organization
- Keep components focused and under 200 lines
- Use existing UI components from src/components/ui/
- Write tests for new components
```

Create similar templates for backend-developer, product-manager, and code-reviewer.

- [ ] **Step 2: Seed default prompts into database**

Add to `prisma/seed.ts`: create AgentPrompt records for each template, reading content from the prompt files. Mark `frontend-developer` as `isDefault: true`.

- [ ] **Step 3: Commit**

```bash
git add prompts/ prisma/seed.ts
git commit -m "feat: add default prompt templates for agent roles"
```

---

### Task 12: Delete deprecated agent-runner.ts

**Files:**
- Delete: `src/lib/agent-runner.ts`

- [ ] **Step 1: Verify no imports remain**

```bash
grep -r "agent-runner" src/ --include="*.ts" --include="*.tsx"
```
Expected: no results (or only the file itself)

- [ ] **Step 2: Delete the file**

```bash
rm src/lib/agent-runner.ts
```

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "refactor: remove deprecated agent-runner.ts, replaced by adapter system"
```

---

### Task 13: Smoke test — end to end

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Test adapter environment check**

```bash
curl -X POST http://localhost:3000/api/adapters/test -H 'Content-Type: application/json' -d '{"adapterType":"claude_local"}'
```
Expected: `{ "ok": true, "checks": [...] }` (or specific failure messages)

- [ ] **Step 3: Test real execution**

1. Open ai-manager UI
2. Navigate to a project with `localPath` set
3. Open a task
4. Send a message (e.g., "list files in the project")
5. Verify: SSE stream shows real Claude Code output
6. Verify: TaskExecution record created with status COMPLETED
7. Verify: TaskMessage with role ASSISTANT saved

- [ ] **Step 4: Test stop execution**

1. Start a long-running task
2. Click stop
3. Verify: process killed, execution marked FAILED

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete adapter execution engine with Claude Code integration"
```
