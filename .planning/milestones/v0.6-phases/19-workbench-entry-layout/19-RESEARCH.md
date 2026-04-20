# Phase 19: Workbench Entry & Layout - Research

**Researched:** 2026-03-31
**Domain:** React resizable panel layout, Next.js App Router client component refactor
**Confidence:** HIGH

## Summary

Phase 19 is a focused refactor of two existing files: `task-page-client.tsx` (extend fixed split to resizable + multi-tab) and `task-detail-panel.tsx` (the "查看详情" entry already exists — it uses `router.push()` in a button). The primary technical work is installing `react-resizable-panels@^2.x` and wiring it into the task page layout.

The v2 API exports `Panel`, `PanelGroup`, and `PanelResizeHandle` (NOT `ResizablePanel` / `ResizablePanelGroup` — those are shadcn wrapper names from a different package). The tab component is already available in `src/components/ui/tabs.tsx` backed by `@base-ui/react/tabs`. No new UI library is needed beyond the resizable panels package.

The "查看详情" button already exists in `task-detail-panel.tsx` (line 247) with the correct `router.push()` behavior and `ExternalLink` icon. The i18n key `taskPage.viewDetails` is already defined in both zh and en. Work for D-07 is **verify and confirm** the button is correctly placed, not create from scratch.

**Primary recommendation:** Install `react-resizable-panels@2.1.9`, replace the fixed-width `w-[40%]` / `w-[60%]` divs in `task-page-client.tsx` with `PanelGroup` + `Panel` + `PanelResizeHandle`, then add the three-tab bar using the existing shadcn `Tabs` component.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Install `react-resizable-panels@^2.x` (NOT v4 — v4 has breaking export renames). Use ResizablePanelGroup with two panels: left (chat) and right (tabs).
- **D-02:** Default proportions are 35% chat / 65% right panel. User can drag the resize handle.
- **D-03:** Minimum panel width is 20% for each side — prevents accidentally hiding either panel.
- **D-04:** Right panel has three tabs in order: **Files** / **Changes** / **Preview**. Default selected tab is **Files**.
- **D-05:** Tabs display both icon and text label. Icons: FolderTree (Files), GitCompare (Changes), Eye (Preview) from lucide-react.
- **D-06:** Preview tab is hidden when the project type is "backend" (ties into PV-01 from Phase 23, but the tab visibility logic can be wired now with a placeholder check).
- **D-07:** "查看详情" button is placed in the task drawer header area, next to the task title, using ExternalLink icon. Uses `router.push()` for same-tab navigation (current behavior).
- **D-08:** Back navigation from task page keeps the existing back arrow link to board page — no changes needed.

### Claude's Discretion
- Tab component implementation details (custom tabs vs shadcn Tabs)
- Exact placeholder content for Files and Preview tabs (simple centered text is fine)
- Whether to refactor existing "Changes" tab content in-place or extract to a wrapper component
- i18n key naming for new tab labels and "查看详情" button text

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WB-01 | 用户可从任务抽屉点击"查看详情"跳转到任务专属工作台页面 | Button already exists in task-detail-panel.tsx (line 247); verify placement and i18n key |
| WB-02 | 工作台页面左侧为 AI 聊天窗口，右侧为多标签面板（文件/变更/预览） | react-resizable-panels v2 PanelGroup + Panel + PanelResizeHandle replaces fixed-width divs; existing Tabs component handles tab bar |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-resizable-panels | 2.1.9 | Draggable split-pane layout | Locked decision D-01; v2 is stable, v4 has breaking export renames |
| @base-ui/react/tabs | ^1.3.0 (already installed) | Tab navigation for right panel | Already in project as shadcn tabs.tsx backing |
| lucide-react | ^1.6.0 (already installed) | FolderTree, GitCompare, Eye icons | Already used throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next/navigation useRouter | (Next.js 16.2.1) | router.push() for workbench navigation | Task drawer "查看详情" button |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-resizable-panels v2 | v4 | v4 has breaking export renames — D-01 explicitly forbids it |
| shadcn Tabs (base-ui backed) | Custom tab buttons | Custom buttons already used in task-detail-panel; shadcn Tabs provides accessible ARIA semantics — use shadcn Tabs for consistency |

**Installation:**
```bash
npm install react-resizable-panels@^2.1.9
```

**Version verification (confirmed 2026-03-31):**
```
react-resizable-panels@2.1.9 — latest v2.x, published to npm registry
```

## Architecture Patterns

### Recommended Project Structure

No new directories needed. Changes confined to:
```
src/
├── app/workspaces/[workspaceId]/tasks/[taskId]/
│   └── task-page-client.tsx   # REFACTOR: fixed split → PanelGroup + Tabs
├── components/task/
│   └── task-detail-panel.tsx  # VERIFY: "查看详情" button (already exists)
└── lib/
    └── i18n.tsx               # ADD: new i18n keys for Files/Preview tab labels
```

### Pattern 1: react-resizable-panels v2 Layout

**What:** Replace fixed `w-[40%]` / `w-[60%]` divs with `PanelGroup` + two `Panel` + `PanelResizeHandle`.

**Key v2 API facts (verified from package type definitions):**
- Export names: `Panel`, `PanelGroup`, `PanelResizeHandle` (exact names — NOT `ResizablePanel`)
- `PanelGroup` requires `direction` prop: `"horizontal"` or `"vertical"`
- `Panel` key props: `defaultSize` (number, percentage 0-100), `minSize` (number, percentage), `maxSize` (number)
- `PanelResizeHandle` is a plain div with drag behavior — must add visual styling manually (no built-in handle glyph)
- `PanelGroup` accepts `className` and `style` for full-height layout

**When to use:** Anytime user-draggable split layout is required.

**Example:**
```typescript
// Source: react-resizable-panels v2.1.9 type definitions (verified)
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

<PanelGroup direction="horizontal" className="flex h-screen">
  {/* Left: Chat (35% default, 20% minimum) */}
  <Panel defaultSize={35} minSize={20} className="flex flex-col">
    {/* chat content */}
  </Panel>

  {/* Drag handle */}
  <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />

  {/* Right: Tabs (65% default, 20% minimum) */}
  <Panel defaultSize={65} minSize={20} className="flex flex-col">
    {/* tab content */}
  </Panel>
</PanelGroup>
```

### Pattern 2: shadcn Tabs for Right Panel

**What:** Use existing `src/components/ui/tabs.tsx` (backed by `@base-ui/react/tabs`) for the Files/Changes/Preview tabs.

**When to use:** The project already has this component. Preferred over custom button tabs for ARIA semantics.

**Example:**
```typescript
// Source: src/components/ui/tabs.tsx (existing)
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FolderTree, GitCompare, Eye } from "lucide-react";

// Note: @base-ui/react/tabs uses value-based selection
<Tabs defaultValue="files" className="flex flex-col h-full">
  <TabsList variant="line" className="border-b border-border rounded-none px-4">
    <TabsTrigger value="files">
      <FolderTree className="h-4 w-4" />
      {t("taskPage.files")}
    </TabsTrigger>
    <TabsTrigger value="changes">
      <GitCompare className="h-4 w-4" />
      {t("taskPage.changes")}
    </TabsTrigger>
    {projectType !== "backend" && (
      <TabsTrigger value="preview">
        <Eye className="h-4 w-4" />
        {t("taskPage.preview")}
      </TabsTrigger>
    )}
  </TabsList>
  <TabsContent value="files" className="flex-1 overflow-auto">
    {/* Placeholder: Phase 20 fills this */}
  </TabsContent>
  <TabsContent value="changes" className="flex-1 overflow-auto">
    {/* Existing TaskDiffView content */}
  </TabsContent>
  <TabsContent value="preview" className="flex-1 overflow-auto">
    {/* Placeholder: Phase 23 fills this */}
  </TabsContent>
</Tabs>
```

### Pattern 3: "查看详情" Entry Point (VERIFY, NOT CREATE)

**What:** The button already exists in `task-detail-panel.tsx` at lines 246-252. It uses `router.push()` with `ExternalLink` icon and the `taskPage.viewDetails` i18n key.

**Verification finding:** The existing implementation matches D-07 exactly:
- Uses `ExternalLink` from lucide-react
- Uses `router.push(`/workspaces/${workspaceId}/tasks/${task.id}`)`
- Uses `t("taskPage.viewDetails")` — i18n key exists in both zh ("查看详情") and en ("View Details")
- Positioned in the tab bar row next to task title tabs

**Action:** Confirm placement in drawer header (currently in tab bar row — acceptable) and verify it works after layout refactor.

### Pattern 4: project.type for Preview Tab Visibility (D-06)

**What:** The serialized task object in `task-page-client.tsx` already includes `project.type` (string: `"NORMAL"` or `"GIT"`). D-06 requires hiding Preview tab when project type is "backend". Since `type` is currently `NORMAL | GIT`, this flag doesn't exist yet — Phase 23 adds it via Prisma migration. For Phase 19, the placeholder check should be: `projectType !== "backend"` where `projectType` defaults to `"frontend"`.

**Implementation:** Pass `project?.type` (or a derived `isFrontend` boolean) from `task-page-client.tsx` props. Since backend type doesn't exist yet, the Preview tab will always be visible in Phase 19 — which is correct placeholder behavior.

### Anti-Patterns to Avoid

- **Using v4 exports:** Do NOT install `react-resizable-panels@^4` or use `ResizablePanel`, `ResizablePanelGroup`, `ResizableHandle` — those are shadcn wrapper names that wrap v4. D-01 is explicit.
- **`className` on PanelGroup without `h-screen`:** PanelGroup renders as a flex container but needs explicit height. Without `h-screen` or `h-full` it collapses.
- **Forgetting `minSize`:** Without `minSize`, panels can be dragged to 0% width, hiding content.
- **Nesting Tabs inside Panel without flex layout:** `TabsContent` needs `flex-1` and the parent Panel needs `flex flex-col` or content won't fill available height.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Draggable split panes | Custom mouse event tracking | react-resizable-panels | Handles touch, keyboard, pointer capture, ARIA correctly |
| Tab navigation | Custom button + state | shadcn Tabs (already installed) | ARIA roles, keyboard nav, base-ui accessibility built-in |

**Key insight:** Both problems have production-ready solutions already in the project. Zero new custom primitives needed.

## Common Pitfalls

### Pitfall 1: PanelGroup height collapse
**What goes wrong:** PanelGroup renders with zero height, content not visible.
**Why it happens:** PanelGroup is a flex container — if its parent doesn't set a height, it collapses.
**How to avoid:** Apply `h-screen` to PanelGroup (the existing outer div already uses `h-screen bg-background`). Replace that outer div with `PanelGroup` or give PanelGroup `className="h-screen"`.
**Warning signs:** Layout renders flat or invisible on first load.

### Pitfall 2: Forgetting the "Changes" tab diff fetch trigger
**What goes wrong:** Diff data never loads because `activeTab` check is gone after refactor.
**Why it happens:** Current code has `if (activeTab !== "changes" || taskStatus !== "IN_REVIEW") return;` guarding the diff fetch in `useEffect`. The task-page-client.tsx currently fetches on `taskStatus` change (not tab change). After adding tabs, the Changes tab content renders when the tab is selected — the fetch logic should stay on `taskStatus === "IN_REVIEW"` (current behavior in task-page-client.tsx is already correct).
**How to avoid:** Keep the existing `useEffect` for diff loading unchanged — it already triggers on `taskStatus` not tab selection.
**Warning signs:** Changes tab shows "No changes" even when task is IN_REVIEW.

### Pitfall 3: @base-ui/react Tabs value prop difference
**What goes wrong:** Tabs don't switch when clicking triggers.
**Why it happens:** `@base-ui/react` Tabs uses `value` (not `activeTab`-style prop). The Tab trigger must use `value` prop matching TabsContent `value`.
**How to avoid:** Use `defaultValue="files"` on `<Tabs>` root and ensure each `<TabsTrigger value="...">` matches its `<TabsContent value="...">`.
**Warning signs:** Tab bar renders but content doesn't change on click.

### Pitfall 4: TaskPageClient prop interface missing project type
**What goes wrong:** Cannot implement D-06 preview tab visibility check.
**Why it happens:** The `project.type` field IS already in the serialized task object (`task.project.type`), but the `TaskPageClientProps` interface must include it explicitly.
**How to avoid:** The interface already has `project: { id: string; name: string; type: string; localPath: string | null } | null` — `type` is there. Use `task.project?.type` directly.
**Warning signs:** TypeScript error on `task.project.type` access.

## Code Examples

### Installing react-resizable-panels v2
```bash
# Source: npm registry verified 2026-03-31
npm install react-resizable-panels@^2.1.9
```

### Full PanelGroup import (v2)
```typescript
// Source: react-resizable-panels v2.1.9 index.d.ts (verified)
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
// NOT: ResizablePanel, ResizablePanelGroup, ResizableHandle (those are shadcn v4 wrappers)
```

### Resize handle with visual indicator
```typescript
// Source: react-resizable-panels v2 PanelResizeHandle.d.ts (verified)
<PanelResizeHandle className="relative w-px bg-border hover:bg-primary transition-colors group">
  <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
</PanelResizeHandle>
```

### i18n keys to add (new keys needed)
```typescript
// In zh translations:
"taskPage.files": "文件",
"taskPage.preview": "预览",
// Note: "taskPage.changes" already exists as "变更"
// Note: "taskPage.viewDetails" already exists as "查看详情"
```

### Existing "查看详情" button (task-detail-panel.tsx lines 246-252)
```typescript
// Already implemented — source: task-detail-panel.tsx
<button
  onClick={() => router.push(`/workspaces/${workspaceId}/tasks/${task.id}`)}
  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
>
  <ExternalLink className="h-3 w-3" />
  {t("taskPage.viewDetails")}
</button>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed `w-[40%]` / `w-[60%]` divs | PanelGroup with draggable handle | Phase 19 | Users can adjust chat/content ratio |
| Single "Changes" tab button | Three tabs: Files / Changes / Preview | Phase 19 | Scaffold for Phases 20-23 features |

**Deprecated/outdated:**
- The manual `role="tab"` + `aria-selected` buttons in `task-page-client.tsx` (lines 291-298): Remove in favor of shadcn Tabs component.

## Open Questions

1. **shadcn Tabs "line" variant border styling**
   - What we know: The `tabsListVariants` "line" variant removes the rounded pill background
   - What's unclear: Whether the bottom border underline indicator (via `after:` pseudo-element) works well in a horizontal border-b layout
   - Recommendation: Use `variant="line"` and add `border-b border-border` to the `TabsList` for a clean IDE-style tab bar. Test visually.

2. **Preview tab default visibility for existing projects**
   - What we know: D-06 hides Preview when project type is "backend". Currently all projects are `NORMAL` or `GIT` — no "backend" type exists until Phase 23.
   - What's unclear: Should Preview tab be shown for ALL projects in Phase 19?
   - Recommendation: Yes — since `project.type` is never "backend" in Phase 19, the conditional `{projectType !== "backend" && ...}` evaluates to always-true. Preview tab renders for all projects. This is correct placeholder behavior.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / npm | Install react-resizable-panels | ✓ | System npm | — |
| react-resizable-panels | PanelGroup layout | ✗ (not installed) | — | None — must install |
| lucide-react | FolderTree, GitCompare, Eye icons | ✓ | ^1.6.0 | — |
| @base-ui/react | Tabs component | ✓ | ^1.3.0 | — |

**Missing dependencies with no fallback:**
- react-resizable-panels: Must install before implementing layout (Wave 0 task)

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 6.x + Playwright |
| Config file | vitest.config.ts / playwright.config.ts |
| Quick run command | `npx vitest run tests/unit/` |
| Full suite command | `npx vitest run && npx playwright test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WB-01 | "查看详情" button navigates to task workbench URL | E2E smoke | `npx playwright test tests/e2e/smoke.spec.ts` | ✅ (smoke.spec.ts exists) |
| WB-02 | Task page shows resizable left/right panels + three tabs | E2E | `npx playwright test tests/e2e/` | ❌ New test needed |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit/` (unit tests only, fast)
- **Per wave merge:** `npx vitest run && npx playwright test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/e2e/workbench.spec.ts` — covers WB-01 (navigate from drawer to task page) and WB-02 (panel + tab layout renders)
- [ ] `npm install react-resizable-panels@^2.1.9` — must be installed before any implementation

## Sources

### Primary (HIGH confidence)
- react-resizable-panels v2.1.9 npm tarball (type definitions extracted 2026-03-31) — PanelGroup/Panel/PanelResizeHandle props, export names
- `src/components/ui/tabs.tsx` (read directly) — @base-ui/react Tabs API and variants
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` (read directly) — current layout structure
- `src/components/task/task-detail-panel.tsx` (read directly) — "查看详情" button already present
- `src/lib/i18n.tsx` (read directly) — existing taskPage.* keys

### Secondary (MEDIUM confidence)
- npm registry metadata for react-resizable-panels@2.1.9 — peerDependencies (React 16-19 compatible)
- WebSearch cross-reference: v4 has breaking renames confirmed (shadcn/ui issue #9197)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — v2 type definitions extracted directly from package
- Architecture: HIGH — all source files read directly, no inference needed
- Pitfalls: HIGH — derived from reading actual code and v2 API types

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (react-resizable-panels v2 is stable; @base-ui/react is stable)
