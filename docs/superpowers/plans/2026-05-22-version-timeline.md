# 版本时间线（Version Timeline）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个项目引入「版本」层，把任务按版本归纳为 `版本 → 任务 → 资源/笔记` 的时间线视图，并记录版本的 git 基线区间用于版本级 diff。

**Architecture:** 新增 `Version` 模型挂在 `Project` 下，`Task` 加可空 `versionId`。服务端用 `src/actions/version-actions.ts`（"use server" + Zod + Prisma）做 CRUD / 设当前 / 发布滚动；git 区间用 `src/lib/version-git.ts`（`execFileSync`）捕获 `baseCommit`/`releaseCommit` 并算 diff 统计。前端新增 `/workspaces/[workspaceId]/projects/[projectId]/versions` 路由渲染时间线（视觉以 `~/Downloads/version-timeline-mockup-v2.html` 为准）。

**Tech Stack:** Next.js 16 (App Router) / TypeScript / Prisma + SQLite（`prisma db push`，无 migrations 目录）/ vitest（jsdom，`vi.mock`）/ TailwindCSS 4 + shadcn / i18n `zh|en`。

**Spec:** `docs/superpowers/specs/2026-05-22-version-timeline-design.md`

---

## 约定与现有模式（实现前必读）

- **DB 客户端**：`import { db } from "@/lib/db"`。schema 改完跑 `pnpm db:push`（**不要**写 migration 文件）。
- **Server action**：文件顶部 `"use server"`；入参用 `src/lib/schemas.ts` 里的 Zod schema `.parse()`；写操作结尾 `revalidatePath("/workspaces")`；Prisma `P2025`（记录不存在）要 catch 并返回友好错误（见 `.claude/rules/security.md`）。
- **测试**：vitest。action 测试 `vi.mock("@/lib/db", ...)` + `vi.mock("next/cache", ...)`，参考 `src/actions/__tests__/asset-actions.test.ts`。纯逻辑（git 解析）单测 mock `child_process`。运行：`pnpm test:run <path>`。
- **git 调用**：服务端用 `execFileSync("git", [...], { cwd, encoding:"utf-8", timeout })`，参考 `src/actions/task-actions.ts:55-77`。
- **i18n**：所有 UI 文案 `t("key")`，在 `src/lib/i18n/zh.ts` 与 `src/lib/i18n/en.ts` 同步加 key（两文件 key 必须一致）。
- **UI 规则**（`.claude/rules/ui.md`）：按钮用 `<Button>`；Select 不用 `<SelectValue/>`；Toast 用 `sonner`；图标用 lucide-react SVG。
- **提交**：每个 Task 末尾 commit，scope 用 `version`，如 `feat(version): ...`。

---

## File Structure

**新建：**
- `src/lib/version-git.ts` — 纯 git 辅助：取分支 HEAD、算 diff 统计（可单测）。
- `src/lib/__tests__/version-git.test.ts`
- `src/actions/version-actions.ts` — 版本 CRUD / setCurrent / release / assignTaskVersion / diff。
- `src/actions/__tests__/version-actions.test.ts`
- `src/app/workspaces/[workspaceId]/projects/[projectId]/versions/page.tsx` — 服务端页面（取数）。
- `src/app/workspaces/[workspaceId]/projects/[projectId]/versions/version-timeline-client.tsx` — 客户端时间线根组件。
- `src/components/version/version-card.tsx` — 单个版本卡（含任务/资源/笔记树）。
- `src/components/version/version-form-dialog.tsx` — 新建/编辑版本弹窗。
- `src/components/version/release-version-dialog.tsx` — 发布弹窗（选下一个当前版本）。
- `src/components/version/version-badges.tsx` — type/status 徽章 + 图标小组件（复用）。
- `src/components/version/__tests__/version-badges.test.tsx`

**修改：**
- `prisma/schema.prisma` — 加 `Version` 模型、`VersionType`/`VersionStatus` 枚举、`Project.versions`、`Task.versionId`+`Task.version`。
- `src/lib/schemas.ts` — 加 `createVersionSchema` / `updateVersionSchema`。
- `src/lib/schemas.ts` 的 `createTaskSchema`/`updateTaskSchema` — 加可选 `versionId`。
- `src/actions/task-actions.ts` — `createTask`/`updateTask` 支持 `versionId`。
- `src/components/board/create-task-dialog.tsx` — 加版本选择器（默认填当前版本）。
- `src/app/workspaces/[workspaceId]/board-page-client.tsx` — 加「版本时间线」入口按钮。
- `src/lib/i18n/zh.ts` / `src/lib/i18n/en.ts` — 新增 `version.*` 文案。

---

## Phase 1 — Schema & 数据层

### Task 1: 新增 Version 模型与 Task.versionId

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 在 `prisma/schema.prisma` 末尾的 enum 区加两个枚举**

```prisma
enum VersionType {
  FEATURE
  BUGFIX
  RESEARCH
}

enum VersionStatus {
  PLANNED
  ACTIVE
  RELEASED
}
```

- [ ] **Step 2: 新增 `Version` 模型（放在 `Repository` 模型附近）**

```prisma
model Version {
  id            String        @id @default(cuid())
  number        String
  name          String
  type          VersionType   @default(FEATURE)
  status        VersionStatus @default(PLANNED)
  isCurrent     Boolean       @default(false)
  baseBranch    String?
  baseCommit    String?
  releaseCommit String?
  startDate     DateTime?
  targetDate    DateTime?
  releasedAt    DateTime?
  description   String?
  order         Int           @default(0)
  projectId     String
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tasks   Task[]

  @@index([projectId])
  @@index([isCurrent])
}
```

- [ ] **Step 3: 在 `Project` 模型 relations 区加 `versions Version[]`**（紧跟 `assets ProjectAsset[]` 之后）

- [ ] **Step 4: 在 `Task` 模型加版本字段**

`Task` 的标量区加 `versionId String?`，relations 区加：
```prisma
  version    Version?        @relation(fields: [versionId], references: [id], onDelete: SetNull)
```
并在底部加 `@@index([versionId])`。

- [ ] **Step 5: 同步 schema 并重新生成 client**

Run: `pnpm db:push && pnpm prisma generate`
Expected: `Your database is now in sync with your Prisma schema.`，无报错。

- [ ] **Step 6: 类型校验冒烟**

Run: `pnpm exec tsc --noEmit`
Expected: 不因 `Version`/`versionId` 报新错（已有无关错误忽略）。

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(version): add Version model and Task.versionId"
```

---

## Phase 2 — git 辅助 + 版本 CRUD / 当前版本 / 任务归属

### Task 2: version-git 辅助（取分支 HEAD + diff 统计）

**Files:**
- Create: `src/lib/version-git.ts`
- Test: `src/lib/__tests__/version-git.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileSync = vi.fn();
vi.mock("child_process", () => ({ execFileSync: (...a: unknown[]) => execFileSync(...a) }));

import { getBranchHead, getDiffStat } from "@/lib/version-git";

beforeEach(() => execFileSync.mockReset());

describe("getBranchHead", () => {
  it("returns trimmed commit for a branch", () => {
    execFileSync.mockReturnValue("a1b2c3d4e5\n");
    expect(getBranchHead("/repo", "main")).toBe("a1b2c3d4e5");
    expect(execFileSync).toHaveBeenCalledWith("git", ["rev-parse", "main"], expect.objectContaining({ cwd: "/repo" }));
  });
  it("returns null when git fails", () => {
    execFileSync.mockImplementation(() => { throw new Error("no repo"); });
    expect(getBranchHead("/repo", "main")).toBeNull();
  });
});

describe("getDiffStat", () => {
  it("parses numstat into additions/deletions/files", () => {
    execFileSync.mockReturnValue("10\t2\tsrc/a.ts\n5\t0\tsrc/b.ts\n");
    expect(getDiffStat("/repo", "aaa", "bbb")).toEqual({ additions: 15, deletions: 2, files: 2 });
  });
  it("returns zeros when git fails", () => {
    execFileSync.mockImplementation(() => { throw new Error("bad range"); });
    expect(getDiffStat("/repo", "aaa", "bbb")).toEqual({ additions: 0, deletions: 0, files: 0 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/lib/__tests__/version-git.test.ts`
Expected: FAIL（`version-git` 模块不存在）。

- [ ] **Step 3: 实现 `src/lib/version-git.ts`**

```ts
import { execFileSync } from "child_process";

const GIT_TIMEOUT = 5000;

/** 取某分支（或 ref）的 HEAD commit；失败返回 null。 */
export function getBranchHead(cwd: string, branch: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", branch], { cwd, encoding: "utf-8", timeout: GIT_TIMEOUT });
    const hash = out.trim();
    return hash || null;
  } catch {
    return null;
  }
}

export interface DiffStat { additions: number; deletions: number; files: number; }

/** 计算 from..to 的增删行数与文件数；失败返回全 0。 */
export function getDiffStat(cwd: string, from: string, to: string): DiffStat {
  try {
    const out = execFileSync("git", ["diff", "--numstat", `${from}..${to}`], { cwd, encoding: "utf-8", timeout: GIT_TIMEOUT });
    let additions = 0, deletions = 0, files = 0;
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const [add, del] = t.split("\t");
      additions += Number.parseInt(add, 10) || 0;
      deletions += Number.parseInt(del, 10) || 0;
      files += 1;
    }
    return { additions, deletions, files };
  } catch {
    return { additions: 0, deletions: 0, files: 0 };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/lib/__tests__/version-git.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/version-git.ts src/lib/__tests__/version-git.test.ts
git commit -m "feat(version): add git helpers for base commit and diff stat"
```

### Task 3: 版本 Zod schemas

**Files:**
- Modify: `src/lib/schemas.ts`

- [ ] **Step 1: 在 `src/lib/schemas.ts` 末尾追加**

```ts
// ── Version schemas ──
export const createVersionSchema = z.object({
  number: z.string().min(1, "Number is required").max(50),
  name: z.string().min(1, "Name is required").max(100),
  type: z.enum(["FEATURE", "BUGFIX", "RESEARCH"]).optional(),
  baseBranch: z.string().max(200).optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
  description: z.string().max(5000).optional(),
  projectId: cuid,
  setCurrent: z.boolean().optional(),
});

export const updateVersionSchema = z.object({
  number: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["FEATURE", "BUGFIX", "RESEARCH"]).optional(),
  baseBranch: z.string().max(200).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
});
```

- [ ] **Step 2: 在 `createTaskSchema` / `updateTaskSchema` 各加一行**

```ts
  versionId: cuid.optional(),
```

- [ ] **Step 3: 类型校验**

Run: `pnpm exec tsc --noEmit`
Expected: 不引入新错误。

- [ ] **Step 4: Commit**

```bash
git add src/lib/schemas.ts
git commit -m "feat(version): add version zod schemas and task versionId"
```

### Task 4: 版本 CRUD action（含创建时捕获 baseCommit）

**Files:**
- Create: `src/actions/version-actions.ts`
- Test: `src/actions/__tests__/version-actions.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    version: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    project: { findUnique: vi.fn() },
    task: { updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn((globalThis as any).__tx)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/version-git", () => ({ getBranchHead: vi.fn(() => "deadbeef"), getDiffStat: vi.fn(() => ({ additions: 0, deletions: 0, files: 0 })) }));

import { db } from "@/lib/db";
import { getBranchHead } from "@/lib/version-git";
import { createVersion, getProjectVersions } from "@/actions/version-actions";

beforeEach(() => vi.clearAllMocks());

describe("createVersion", () => {
  it("captures baseCommit from baseBranch when project has localPath", async () => {
    (db.project.findUnique as any).mockResolvedValue({ id: "p1", localPath: "/repo" });
    (db.version.create as any).mockResolvedValue({ id: "v1" });
    await createVersion({ projectId: "p1", number: "v1.1", name: "导出", baseBranch: "main" });
    expect(getBranchHead).toHaveBeenCalledWith("/repo", "main");
    expect((db.version.create as any).mock.calls[0][0].data.baseCommit).toBe("deadbeef");
  });

  it("skips baseCommit when no localPath", async () => {
    (db.project.findUnique as any).mockResolvedValue({ id: "p1", localPath: null });
    (db.version.create as any).mockResolvedValue({ id: "v1" });
    await createVersion({ projectId: "p1", number: "v1.1", name: "导出", baseBranch: "main" });
    expect(getBranchHead).not.toHaveBeenCalled();
    expect((db.version.create as any).mock.calls[0][0].data.baseCommit).toBeNull();
  });
});

describe("getProjectVersions", () => {
  it("queries versions ordered for the project", async () => {
    (db.version.findMany as any).mockResolvedValue([]);
    await getProjectVersions("p1");
    expect((db.version.findMany as any).mock.calls[0][0].where).toEqual({ projectId: "p1" });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/actions/__tests__/version-actions.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/actions/version-actions.ts`（CRUD 部分）**

```ts
"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createVersionSchema, updateVersionSchema } from "@/lib/schemas";
import { getBranchHead } from "@/lib/version-git";

export async function getProjectVersions(projectId: string) {
  return db.version.findMany({
    where: { projectId },
    orderBy: [{ targetDate: "desc" }, { order: "desc" }, { createdAt: "desc" }],
    include: {
      tasks: {
        orderBy: [{ order: "asc" }, { createdAt: "desc" }],
        include: {
          labels: { include: { label: true } },
          assets: { select: { id: true, filename: true, mimeType: true, size: true } },
          notes: { select: { id: true, title: true, category: true } },
        },
      },
    },
  });
}

export async function createVersion(data: {
  projectId: string; number: string; name: string;
  type?: "FEATURE" | "BUGFIX" | "RESEARCH"; baseBranch?: string;
  startDate?: Date; targetDate?: Date; description?: string; setCurrent?: boolean;
}) {
  const v = createVersionSchema.parse(data);
  let baseCommit: string | null = null;
  if (v.baseBranch) {
    const project = await db.project.findUnique({
      where: { id: v.projectId }, select: { localPath: true },
    });
    if (project?.localPath) baseCommit = getBranchHead(project.localPath, v.baseBranch);
  }
  const version = await db.version.create({
    data: {
      projectId: v.projectId, number: v.number, name: v.name,
      type: v.type ?? "FEATURE", status: "PLANNED",
      baseBranch: v.baseBranch ?? null, baseCommit,
      startDate: v.startDate ?? null, targetDate: v.targetDate ?? null,
      description: v.description ?? null,
    },
  });
  if (v.setCurrent) await setCurrentVersion(version.id);
  revalidatePath("/workspaces");
  return version;
}

export async function updateVersion(versionId: string, data: {
  number?: string; name?: string; type?: "FEATURE" | "BUGFIX" | "RESEARCH";
  baseBranch?: string | null; startDate?: Date | null; targetDate?: Date | null; description?: string | null;
}) {
  const v = updateVersionSchema.parse(data);
  try {
    const version = await db.version.update({ where: { id: versionId }, data: v });
    revalidatePath("/workspaces");
    return version;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2025") {
      throw new Error("版本不存在");
    }
    throw e;
  }
}

export async function deleteVersion(versionId: string) {
  try {
    await db.version.delete({ where: { id: versionId } });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2025") {
      throw new Error("版本不存在");
    }
    throw e;
  }
  revalidatePath("/workspaces");
}

// setCurrentVersion 在 Task 5 实现
```

> 注：先放一个占位 `setCurrentVersion` 以便 `createVersion` 编译，Task 5 替换为真实实现。临时占位：
> ```ts
> export async function setCurrentVersion(versionId: string) { void versionId; }
> ```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/actions/__tests__/version-actions.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/actions/version-actions.ts src/actions/__tests__/version-actions.test.ts
git commit -m "feat(version): version CRUD actions with baseCommit capture"
```

### Task 5: 设置当前版本（全项目唯一）

**Files:**
- Modify: `src/actions/version-actions.ts`
- Test: `src/actions/__tests__/version-actions.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
import { setCurrentVersion } from "@/actions/version-actions";

describe("setCurrentVersion", () => {
  it("clears other current flags in the project then sets this one", async () => {
    const tx = { version: { update: vi.fn().mockResolvedValue({ projectId: "p1" }), updateMany: vi.fn() } };
    (globalThis as any).__tx = tx;
    (db.version.findUnique as any).mockResolvedValue({ id: "v1", projectId: "p1" });
    await setCurrentVersion("v1");
    expect(tx.version.updateMany).toHaveBeenCalledWith({ where: { projectId: "p1", isCurrent: true }, data: { isCurrent: false } });
    expect(tx.version.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { isCurrent: true, status: "ACTIVE" } });
  });
});
```

- [ ] **Step 2: 运行确认失败**（占位实现没逻辑）

Run: `pnpm test:run src/actions/__tests__/version-actions.test.ts -t setCurrentVersion`
Expected: FAIL。

- [ ] **Step 3: 用真实实现替换占位 `setCurrentVersion`**

```ts
export async function setCurrentVersion(versionId: string) {
  const version = await db.version.findUnique({ where: { id: versionId }, select: { id: true, projectId: true } });
  if (!version) throw new Error("版本不存在");
  await db.$transaction(async (tx) => {
    await tx.version.updateMany({ where: { projectId: version.projectId, isCurrent: true }, data: { isCurrent: false } });
    await tx.version.update({ where: { id: versionId }, data: { isCurrent: true, status: "ACTIVE" } });
  });
  revalidatePath("/workspaces");
}
```

- [ ] **Step 4: 运行确认通过（全文件）**

Run: `pnpm test:run src/actions/__tests__/version-actions.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/actions/version-actions.ts src/actions/__tests__/version-actions.test.ts
git commit -m "feat(version): setCurrentVersion enforces single current per project"
```

### Task 6: 任务归属版本（assign + createTask/updateTask 接入）

**Files:**
- Modify: `src/actions/version-actions.ts`（加 `assignTaskVersion`）
- Modify: `src/actions/task-actions.ts`（`createTask`/`updateTask` 写 `versionId`）
- Test: `src/actions/__tests__/version-actions.test.ts`

- [ ] **Step 1: 追加失败测试（assignTaskVersion）**

```ts
import { assignTaskVersion } from "@/actions/version-actions";

describe("assignTaskVersion", () => {
  it("sets versionId on the task", async () => {
    (db.task.updateMany as any).mockResolvedValue({ count: 1 });
    await assignTaskVersion("t1", "v2");
    expect((db.task.updateMany as any)).toHaveBeenCalledWith({ where: { id: "t1" }, data: { versionId: "v2" } });
  });
  it("clears versionId when passed null (backlog)", async () => {
    (db.task.updateMany as any).mockResolvedValue({ count: 1 });
    await assignTaskVersion("t1", null);
    expect((db.task.updateMany as any)).toHaveBeenCalledWith({ where: { id: "t1" }, data: { versionId: null } });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/actions/__tests__/version-actions.test.ts -t assignTaskVersion`
Expected: FAIL。

- [ ] **Step 3: 实现 `assignTaskVersion`（version-actions.ts）**

```ts
export async function assignTaskVersion(taskId: string, versionId: string | null) {
  await db.task.updateMany({ where: { id: taskId }, data: { versionId } });
  revalidatePath("/workspaces");
}
```

- [ ] **Step 4: 在 `task-actions.ts` 接入 versionId**

`createTask`：函数签名加 `versionId?: string;`，`db.task.create` 的 `data` 加 `versionId: v.versionId ?? null,`。
`updateTask`：签名加 `versionId?: string | null;`（`updateData` 已展开 `v`，确保 `versionId` 透传到 `db.task.update` 的 data）。

- [ ] **Step 5: 运行测试 + 类型校验**

Run: `pnpm test:run src/actions/__tests__/version-actions.test.ts && pnpm exec tsc --noEmit`
Expected: PASS + 无新类型错误。

- [ ] **Step 6: Commit**

```bash
git add src/actions/version-actions.ts src/actions/task-actions.ts
git commit -m "feat(version): assign task to version and wire createTask/updateTask"
```

---

## Phase 3 — 发布滚动 + 版本级 diff

### Task 7: releaseVersion（发布 + 未完成任务滚动）

**Files:**
- Modify: `src/actions/version-actions.ts`
- Test: `src/actions/__tests__/version-actions.test.ts`

**行为：** 把目标版本置 `RELEASED`、写 `releasedAt` 与 `releaseCommit`（从其 baseBranch 取 HEAD），把该版本下**非 DONE/CANCELLED** 任务的 `versionId` 改到 `nextVersionId`，并把 `nextVersionId` 设为当前版本。

- [ ] **Step 1: 追加失败测试**

```ts
import { releaseVersion } from "@/actions/version-actions";

describe("releaseVersion", () => {
  it("marks released, captures releaseCommit, rolls unfinished tasks, sets next current", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      id: "v1", projectId: "p1", baseBranch: "main",
      project: { localPath: "/repo" },
    });
    const tx = {
      version: { update: vi.fn().mockResolvedValue({}), updateMany: vi.fn() },
      task: { updateMany: vi.fn() },
    };
    (globalThis as any).__tx = tx;
    await releaseVersion("v1", "v2");
    // released
    expect(tx.version.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "v1" },
      data: expect.objectContaining({ status: "RELEASED", releaseCommit: "deadbeef" }),
    }));
    // rollover unfinished -> v2
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { versionId: "v1", status: { notIn: ["DONE", "CANCELLED"] } },
      data: { versionId: "v2" },
    });
    // v2 becomes current
    expect(tx.version.updateMany).toHaveBeenCalledWith({ where: { projectId: "p1", isCurrent: true }, data: { isCurrent: false } });
    expect(tx.version.update).toHaveBeenCalledWith({ where: { id: "v2" }, data: { isCurrent: true, status: "ACTIVE" } });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run src/actions/__tests__/version-actions.test.ts -t releaseVersion`
Expected: FAIL。

- [ ] **Step 3: 实现 `releaseVersion`**

```ts
export async function releaseVersion(versionId: string, nextVersionId: string) {
  const version = await db.version.findUnique({
    where: { id: versionId },
    select: { id: true, projectId: true, baseBranch: true, project: { select: { localPath: true } } },
  });
  if (!version) throw new Error("版本不存在");

  let releaseCommit: string | null = null;
  if (version.baseBranch && version.project?.localPath) {
    releaseCommit = getBranchHead(version.project.localPath, version.baseBranch);
  }

  await db.$transaction(async (tx) => {
    await tx.version.update({
      where: { id: versionId },
      data: { status: "RELEASED", releasedAt: new Date(), releaseCommit, isCurrent: false },
    });
    await tx.task.updateMany({
      where: { versionId, status: { notIn: ["DONE", "CANCELLED"] } },
      data: { versionId: nextVersionId },
    });
    await tx.version.updateMany({ where: { projectId: version.projectId, isCurrent: true }, data: { isCurrent: false } });
    await tx.version.update({ where: { id: nextVersionId }, data: { isCurrent: true, status: "ACTIVE" } });
  });
  revalidatePath("/workspaces");
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run src/actions/__tests__/version-actions.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/actions/version-actions.ts src/actions/__tests__/version-actions.test.ts
git commit -m "feat(version): release flow with unfinished-task rollover"
```

### Task 8: 版本级 diff 统计

**Files:**
- Modify: `src/actions/version-actions.ts`
- Test: `src/actions/__tests__/version-actions.test.ts`

**行为：** `getVersionDiffStat(versionId)` → 用 `baseCommit`（起点）到 `releaseCommit ?? 基线分支当前 HEAD`（终点）算统计；缺 `baseCommit`/`localPath` 时返回 null。

- [ ] **Step 1: 追加失败测试**

```ts
import { getVersionDiffStat } from "@/actions/version-actions";
import { getDiffStat } from "@/lib/version-git";

describe("getVersionDiffStat", () => {
  it("uses baseCommit..releaseCommit when released", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      baseCommit: "aaa", releaseCommit: "bbb", baseBranch: "main", project: { localPath: "/repo" },
    });
    (getDiffStat as any).mockReturnValue({ additions: 9, deletions: 1, files: 3 });
    const r = await getVersionDiffStat("v1");
    expect(getDiffStat).toHaveBeenCalledWith("/repo", "aaa", "bbb");
    expect(r).toEqual({ additions: 9, deletions: 1, files: 3 });
  });
  it("uses live HEAD when not released", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      baseCommit: "aaa", releaseCommit: null, baseBranch: "main", project: { localPath: "/repo" },
    });
    await getVersionDiffStat("v1");
    expect(getBranchHead).toHaveBeenCalledWith("/repo", "main"); // 终点取实时 HEAD
  });
  it("returns null when baseCommit missing", async () => {
    (db.version.findUnique as any).mockResolvedValue({ baseCommit: null, project: { localPath: "/repo" } });
    expect(await getVersionDiffStat("v1")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败** → `pnpm test:run src/actions/__tests__/version-actions.test.ts -t getVersionDiffStat`（FAIL）

- [ ] **Step 3: 实现 `getVersionDiffStat`**

```ts
import { getDiffStat } from "@/lib/version-git";

export async function getVersionDiffStat(versionId: string) {
  const v = await db.version.findUnique({
    where: { id: versionId },
    select: { baseCommit: true, releaseCommit: true, baseBranch: true, project: { select: { localPath: true } } },
  });
  if (!v?.baseCommit || !v.project?.localPath) return null;
  const to = v.releaseCommit ?? (v.baseBranch ? getBranchHead(v.project.localPath, v.baseBranch) : null);
  if (!to) return null;
  return getDiffStat(v.project.localPath, v.baseCommit, to);
}
```

> 注意：`getDiffStat` 已在文件顶部 import（与 `getBranchHead` 同行或新增 import）。

- [ ] **Step 4: 运行确认通过** → `pnpm test:run src/actions/__tests__/version-actions.test.ts`（PASS）

- [ ] **Step 5: Commit**

```bash
git add src/actions/version-actions.ts src/actions/__tests__/version-actions.test.ts
git commit -m "feat(version): version-level diff stat (base..release/HEAD)"
```

---

## Phase 4 — UI：时间线视图

> 视觉基准：`~/Downloads/version-timeline-mockup-v2.html`。颜色：feature=blue, bug=amber, research=violet, released=zinc, 当前=indigo。图标用 lucide-react。所有文案用 `t("version.*")`（文案 key 在 Phase 5 落地，但写组件时即按 key 引用）。

### Task 9: type/status 徽章组件

**Files:**
- Create: `src/components/version/version-badges.tsx`
- Test: `src/components/version/__tests__/version-badges.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VersionTypeBadge, VersionStatusBadge } from "@/components/version/version-badges";

describe("version badges", () => {
  it("renders type label", () => {
    render(<VersionTypeBadge type="BUGFIX" />);
    expect(screen.getByText(/bug/i)).toBeInTheDocument();
  });
  it("renders status label", () => {
    render(<VersionStatusBadge status="RELEASED" />);
    expect(screen.getByText(/已发布|released/i)).toBeInTheDocument();
  });
});
```

> 测试用到 `@testing-library/react`/`jest-dom`——确认 `tests/setup.ts` 已引入 `@testing-library/jest-dom`（参考现有 tsx 测试；若无则在 setup 引入）。

- [ ] **Step 2: 运行确认失败** → `pnpm test:run src/components/version/__tests__/version-badges.test.tsx`

- [ ] **Step 3: 实现 `version-badges.tsx`**（用 `useI18n` 的 `t` 取文案；type→颜色 class 映射；导出 `VersionTypeBadge`、`VersionStatusBadge`、颜色常量）。状态/类型枚举值映射到中英文案 key：`version.type.FEATURE` 等。

- [ ] **Step 4: 运行确认通过** + **Step 5: Commit** `feat(version): version type/status badges`

### Task 10: 版本卡组件（含任务 / 资源 / 笔记树）

**Files:**
- Create: `src/components/version/version-card.tsx`

实现要点（对照 mockup v2）：
- `<details>` 折叠：版本头（号/名/type 徽章/status 徽章/当前徽标/任务计数）→ meta 行（计划日期、`baseBranch`、`baseCommit`、diff 统计）→ 任务列表 → 每个任务 `<details>` 展开资源（assets）+ 笔记（notes）。
- 当前版本（`isCurrent`）：indigo 左强调条 + 卡头淡色底 + 实心「当前 · 默认收集」徽标。
- 已发布版本显示「查看版本 diff」入口（调用已有 git diff 能力 / 预留回调 prop）。
- 接收 props：`version`（含 tasks/assets/notes）、`diffStat`、`onEdit`、`onRelease`、`onAssign` 等回调。
- 图标用 lucide-react（`GitBranch`/`Tag`/`Calendar`/`FileText`/`Image`/`StickyNote` 等）。

- [ ] **Step 1: 实现组件**（无独立单测，靠下一步页面 + 浏览器验证）
- [ ] **Step 2: 类型校验** `pnpm exec tsc --noEmit`
- [ ] **Step 3: Commit** `feat(version): version card with task/resource/note tree`

### Task 11: 版本时间线页面（路由 + 客户端根组件）

**Files:**
- Create: `src/app/workspaces/[workspaceId]/projects/[projectId]/versions/page.tsx`
- Create: `src/app/workspaces/[workspaceId]/projects/[projectId]/versions/version-timeline-client.tsx`

- [ ] **Step 1: 服务端 `page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectVersions } from "@/actions/version-actions";
import { VersionTimelineClient } from "./version-timeline-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props { params: Promise<{ workspaceId: string; projectId: string }>; }

export default async function VersionsPage({ params }: Props) {
  const { workspaceId, projectId } = await params;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, workspaceId: true, localPath: true },
  });
  if (!project || project.workspaceId !== workspaceId) notFound();

  const versions = await getProjectVersions(projectId);
  // History bucket: tasks with versionId === null
  const backlog = await db.task.findMany({
    where: { projectId, versionId: null },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    include: { labels: { include: { label: true } }, assets: { select: { id: true, filename: true } }, notes: { select: { id: true, title: true } } },
  });

  return <VersionTimelineClient workspaceId={workspaceId} project={project} versions={versions} backlog={backlog} />;
}
```

- [ ] **Step 2: 客户端 `version-timeline-client.tsx`**

竖向时间线：按 `targetDate` 渲染 rail + 节点（当前版本 indigo 实心节点）+ `VersionCard` 列表，底部「History」分组渲染 backlog 任务。**排序按 spec §5**：未发布（PLANNED/ACTIVE）按 `targetDate` 在上，已发布（RELEASED）按 `releasedAt` 倒序在下——客户端对 `versions` 做 RELEASED / 非 RELEASED 分桶后分别排序。顶部放「新建版本」按钮（`<Button>`）。新建/编辑用 `VersionFormDialog`（Task 12），发布用 `ReleaseVersionDialog`（Task 13）。用 `useTransition` + 调 `createVersion`/`updateVersion`/`releaseVersion`，成功 `toast.success`。

- [ ] **Step 3: 浏览器验证**

Run: `pnpm dev`，访问 `/workspaces/<wsId>/projects/<projectId>/versions`。
Expected: 时间线渲染版本卡，展开可见任务→资源/笔记；当前版本高亮。先用 `pnpm db:seed` 或手动插入若干版本/任务造数据。

- [ ] **Step 4: Commit** `feat(version): version timeline page and client`

### Task 12: 新建/编辑版本弹窗

**Files:**
- Create: `src/components/version/version-form-dialog.tsx`

- [ ] **Step 1: 实现弹窗**：字段 number / name / type(Select，遵守 `.claude/rules/ui.md` 的 Select 规则) / baseBranch(可复用 create-task-dialog 的分支选择 popover 模式) / startDate / targetDate(date input) / description(Textarea) / 「设为当前版本」开关。提交调 `createVersion` 或 `updateVersion`。`DialogContent` 宽度用 `sm:` 前缀。
- [ ] **Step 2: 浏览器验证**（新建一个版本，确认出现在时间线，baseBranch 填了的话 baseCommit 被记录）
- [ ] **Step 3: Commit** `feat(version): create/edit version dialog`

### Task 13: 发布版本弹窗（选下一个当前版本）

**Files:**
- Create: `src/components/version/release-version-dialog.tsx`

- [ ] **Step 1: 实现**：列出该版本未完成任务数提示「将滚动到新当前版本」；让用户选一个已有 PLANNED/ACTIVE 版本作为下一个当前版本，或现场新建。确认调 `releaseVersion(versionId, nextVersionId)`。
- [ ] **Step 2: 浏览器验证**：发布后旧版本变「已发布」，未完成任务出现在新当前版本下，新版本 isCurrent。
- [ ] **Step 3: Commit** `feat(version): release version dialog with rollover target`

### Task 14: 创建任务时选版本 + 看板入口

**Files:**
- Modify: `src/components/board/create-task-dialog.tsx`
- Modify: `src/app/workspaces/[workspaceId]/board-page-client.tsx`

- [ ] **Step 1: create-task-dialog 加版本选择器**：新增 props `versions`（项目版本列表）与默认值（当前版本 id）；onSubmit/onUpdate 数据加 `versionId`；UI 上版本选择器默认选中当前版本，可改（编辑任务时回填任务现有 versionId，可切换）。透传到 `createTask`/`updateTask`。
- [ ] **Step 2: board-page-client 加入口按钮**：项目工具区加一个 `<Button variant="outline">` 链接到 `/workspaces/${workspaceId}/projects/${projectId}/versions`（图标 + 文案 `t("version.timeline")`）。
- [ ] **Step 3: 浏览器验证**：新建任务默认进当前版本；时间线对应版本下出现该任务。
- [ ] **Step 4: 类型校验 + Commit** `feat(version): task version picker and board entry`

---

## Phase 5 — i18n + 收尾

### Task 15: i18n 文案（zh + en）

**Files:**
- Modify: `src/lib/i18n/zh.ts`、`src/lib/i18n/en.ts`

- [ ] **Step 1: 两文件同步新增 `version.*` key**（key 必须完全一致）：

```
version.timeline / version.new / version.edit / version.release
version.current / version.backlog（History）
version.type.FEATURE | BUGFIX | RESEARCH
version.status.PLANNED | ACTIVE | RELEASED
version.field.number | name | type | baseBranch | startDate | targetDate | description | setCurrent
version.diff.view / version.diff.files
version.release.rolloverHint / version.release.nextVersion
```
（zh 给中文值，en 给英文值。）

- [ ] **Step 2: 全局替换组件内硬编码文案为 `t("version.*")`**（version-badges / version-card / 弹窗 / client）。
- [ ] **Step 3: 浏览器切换语言验证** zh/en 都正常。
- [ ] **Step 4: Commit** `feat(i18n): version timeline zh/en strings`

### Task 16: 全量校验

- [ ] **Step 1: 全量测试** `pnpm test:run`（全绿）
- [ ] **Step 2: 类型校验** `pnpm exec tsc --noEmit`（无新错误）
- [ ] **Step 3: 端到端手验**（golden path）：新建版本 → 设当前 → 建任务默认进当前 → 任务加资源/笔记 → 时间线展开可见 → 发布版本（未完成滚动）→ 已发布显示 diff 统计 → 历史无版本任务进 History。
- [ ] **Step 4: Commit**（如有收尾改动）`chore(version): finalize version timeline`

---

## 风险 / 注意

- **发布需有「下一个当前版本」**：`releaseVersion` 要求传 `nextVersionId`；UI 在无可选版本时引导现场新建（弹窗内）。
- **无 localPath / 非 git 项目**：`baseCommit`/`releaseCommit`/diff 全部优雅降级为 null/0，UI 不显示 diff 区。
- **backlog 兜底**：项目无版本时任务 `versionId=null`，进 History；首个版本建好后用 `assignTaskVersion` 手动归类。
- **`number` 自由字符串**：排序以 `targetDate`/`order` 为准，不解析版本号。
- **TDD 边界**：git 与数据库副作用集中在 `version-git.ts` / action 内，单测靠 mock；UI 靠 `pnpm dev` 浏览器手验（项目约定 UI 用 Playwright E2E，不强求单测）。
