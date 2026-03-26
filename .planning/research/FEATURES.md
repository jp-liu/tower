# Feature Research

**Domain:** Settings page for AI task management tool (localhost dev tool)
**Researched:** 2026-03-26
**Confidence:** HIGH — analysis based on existing codebase + known patterns for this domain

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any settings page. Missing these = settings page feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Language toggle (zh/en) | i18n already exists via React Context + localStorage; users expect a UI to change it | LOW | `useI18n().setLocale()` already works. Just needs a UI control in Settings. Translations for settings keys partially exist (`settings.language`, `settings.languageDesc`). |
| Theme toggle (light/dark) | Every modern web tool has it; users notice absence immediately | LOW | No theme system exists yet. Tailwind CSS dark mode with `localStorage` persistence is the standard approach. Needs a `class="dark"` strategy on `<html>` or a wrapping div. |
| Persist appearance preferences | Users expect preferences to survive page reload | LOW | Language already persists via `localStorage`. Theme will need same pattern. |
| CLI tool status display | Settings > AI Tools is the logical place to show "is Claude Code working?"; current UI has a hardcoded green "检测到最近使用" banner with no real data | MEDIUM | `testEnvironment(cwd)` in `claude-local/test.ts` returns `TestResult` with named checks. Needs a Server Action wrapper + client-side fetch + status display per check. |
| Prompt list view | `AgentPrompt` model and full CRUD actions exist but have zero UI; basic list is table stakes for a management section | LOW | `getPrompts()` server action exists. Needs a read-only list before CRUD UI. |
| Prompt create/edit form | Any "management" section must support adding and editing entries | MEDIUM | `createPrompt` / `updatePrompt` server actions exist. Form needs name, description, content (textarea), isDefault toggle. 100K char limit already enforced server-side. |
| Prompt delete with confirmation | Standard for destructive action | LOW | `deletePrompt` action exists. Needs confirmation dialog to prevent accidents. |

### Differentiators (Competitive Advantage)

Features that set this tool apart within the AI task management space. Aligned with the project's core value: AI-assisted local task execution.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Live CLI verification with per-check breakdown | Instead of a simple pass/fail, showing each check (`claude_command_resolvable`, `anthropic_api_key`, `claude_hello_probe`) with status + actionable message lets power users debug setup instantly | MEDIUM | `TestCheck[]` already has `name`, `passed`, `message`. UI renders them as a checklist. The "hello probe" takes up to 45s — needs async trigger (button click), not on-load auto-run. |
| Prompt selection during task creation | `Task.promptId` field exists in schema but is disconnected from `createTask` action and `CreateTaskDialog`. Connecting this lets users attach context prompts to tasks at creation time | MEDIUM | Requires: (1) pass prompt list into `CreateTaskDialog`, (2) add promptId to `onSubmit` payload, (3) update `createTask` action signature, (4) update `updateTask` if editing. This is a cross-feature change. |
| Default prompt auto-selection | `AgentPrompt.isDefault` exists. The default prompt could pre-select in task creation dialog, reducing friction for users who always want the same context | LOW | Piggybacks on prompt-in-task-creation feature. Read default prompt in dialog, set as initial state. |
| Workspace-scoped vs global prompts | `AgentPrompt.workspaceId` is nullable — null means global, non-null means workspace-specific. Surface this scope in the UI so users can organize prompts by context | MEDIUM | Requires passing `workspaceId` context into the settings page or making scope explicit in the prompt form. Currently `getPrompts(workspaceId?)` already handles scoping server-side. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem obvious but create unnecessary complexity or conflict with the existing design.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-run CLI verification on settings page load | "Show status immediately" feels helpful | The hello probe takes up to 45s and spawns a child process. Running it on every settings page open blocks the UI and wastes resources for users who aren't diagnosing issues | On-demand "Test Connection" button with loading state. Cache result in component state for the session. |
| Real-time/live CLI status polling | "Always know if Claude is connected" | Continuous polling is expensive and meaningless for a localhost tool that doesn't change state during normal use | One-shot test on button click. Re-run manually if environment changes. |
| Per-workspace agent configs | "Different projects use different agents" | `AgentConfig` is already workspace-agnostic by design; adding scoping adds indirection without value for a single-user local tool | Use the existing `configName` field for named configurations within the same agent. |
| Prompt versioning / history | "Track changes to prompts" | Adds significant complexity (new model, migration) with low value for a localhost single-user tool at this stage | Prompts can be edited freely; no version history needed for v1. Users can duplicate a prompt to preserve old content. |
| Bulk import/export of prompts | "Share prompts between instances" | Not needed for the single-user localhost scope defined in PROJECT.md | Out of scope. Keep prompts local to the SQLite database. |
| Settings search/filter | "Too many settings to scroll through" | There are only 3 nav sections and a handful of settings. Search adds complexity for minimal return | The existing left-nav with 3 sections is sufficient. Add "General" section alongside existing AI Tools. |

---

## Feature Dependencies

```
[General Settings — Language Toggle]
    └──uses──> [existing useI18n().setLocale()]  (zero backend work)

[General Settings — Theme Toggle]
    └──requires──> [theme CSS strategy on <html> element]  (new: add dark: classes or CSS vars)
    └──requires──> [localStorage persistence]  (same pattern as locale)

[CLI Verification — Live Test Button]
    └──requires──> [Server Action wrapping testEnvironment()]  (new server action)
    └──requires──> [client component with async state]  (loading / result display)

[Agent Prompt Management — CRUD UI]
    └──uses──> [existing prompt-actions.ts]  (all 4 actions exist)
    └──requires──> [Settings nav "General" section added]  (nav restructure)

[Prompt Selection in Task Creation]
    └──requires──> [Agent Prompt CRUD UI]  (prompts must exist before selecting)
    └──requires──> [createTask action updated with promptId param]
    └──requires──> [CreateTaskDialog updated with prompt selector]
    └──uses──> [AgentPrompt.isDefault for auto-selection]

[Default Prompt Auto-Selection]
    └──requires──> [Prompt Selection in Task Creation]
    └──uses──> [AgentPrompt.isDefault flag]
```

### Dependency Notes

- **CLI Verification requires a new Server Action:** `testEnvironment(cwd)` is in `src/lib/adapters/claude-local/test.ts`, not a server action. A thin wrapper in `agent-config-actions.ts` or a new `environment-actions.ts` is needed. The `cwd` parameter can default to `process.cwd()` for the server-side check.
- **Prompt Management is prerequisite for Prompt Selection in Task Creation:** Users must be able to create prompts before selecting them. Both must ship in the same milestone.
- **Theme Toggle is independent:** No dependency on any other Settings feature. Can be implemented first or last.
- **Language Toggle is already wired:** Only UI work needed.

---

## MVP Definition

### Launch With (Settings v0.1)

Minimum set for the milestone to feel complete and deliver the stated goal (PROJECT.md: "重构设置页面").

- [ ] **General Settings section** — new nav item with language toggle (use existing `setLocale`) and theme toggle (dark/light/system). Both persist to `localStorage`.
- [ ] **CLI verification — on-demand test** — "Test Connection" button calls `testEnvironment()` via server action, renders per-check results with pass/fail icons and the message string. Not auto-run.
- [ ] **Agent Prompt CRUD** — list view, create dialog (name + description + content textarea + isDefault toggle), inline edit, delete with confirmation. Wire to existing `prompt-actions.ts`.
- [ ] **Prompt selection in task creation** — add prompt selector to `CreateTaskDialog`, pass `promptId` through `createTask` action. Pre-select default prompt if one exists.
- [ ] **i18n coverage** — all new strings added to both zh and en translation maps in `src/lib/i18n.tsx`.

### Add After Validation (v1.x)

- [ ] **Workspace-scoped prompts in UI** — surface scope choice (global vs workspace) in the create/edit form once users have multiple workspaces with different needs.
- [ ] **Prompt selector in edit task dialog** — `CreateTaskDialog` already handles edit mode; extend `updateTask` to accept `promptId` once create path is validated.

### Future Consideration (v2+)

- [ ] **Additional adapter support** — settings UI for non-Claude agents (MINIMAX is listed in `AVAILABLE_AGENTS` but has no adapter). Out of scope until an adapter exists.
- [ ] **Export/import prompts** — JSON export for sharing between installations. Out of scope for single-user localhost v1.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Language toggle in General Settings | MEDIUM | LOW | P1 |
| Theme toggle in General Settings | HIGH | LOW | P1 |
| CLI verification (on-demand) | HIGH | MEDIUM | P1 |
| Agent Prompt CRUD UI | HIGH | MEDIUM | P1 |
| Prompt selection in task creation | HIGH | MEDIUM | P1 |
| Default prompt auto-selection | MEDIUM | LOW | P1 (piggybacks on above) |
| Settings nav restructure (add General) | LOW | LOW | P1 (prerequisite for General section) |
| Workspace-scoped prompts in UI | LOW | MEDIUM | P2 |
| Prompt edit in task dialog | LOW | LOW | P2 |

**Priority key:**
- P1: Must have for milestone v0.1
- P2: Should have, add when validated
- P3: Nice to have, future consideration

---

## Implementation Notes by Feature

### General Settings — Theme Toggle

No dark mode CSS strategy exists. Two common approaches for Next.js + Tailwind:
1. `next-themes` library — adds `class="dark"` to `<html>`, zero boilerplate (HIGH confidence, standard)
2. Manual `localStorage` + `useEffect` to toggle `document.documentElement.classList` — same pattern as the existing locale implementation, no new dependency

Recommendation: Manual approach matches the existing locale pattern exactly. Add `theme` key to `localStorage`, apply `dark` class to `html` in a `useEffect` or via a script tag in `layout.tsx` to avoid flash of unstyled content (FOUC).

### CLI Verification — Server Action Wrapper

`testEnvironment` in `claude-local/test.ts` already runs 3 checks. The server action wrapper:
```typescript
// agent-config-actions.ts or environment-actions.ts
export async function testAgentEnvironment(): Promise<TestResult> {
  const { testEnvironment } = await import("@/lib/adapters/claude-local");
  return testEnvironment(process.cwd());
}
```
The hello probe takes up to 45 seconds. The client component must show a spinner and not time out via Next.js default fetch limits.

### Settings Nav Restructure

Current nav has: AI Tools | Skills | Plugins
New nav needed: General | AI Tools | Agent Prompts (rename/add) | Skills | Plugins

"Skills" and "Plugins" remain as placeholders ("开发中"). Add "General" (通用) at top. Rename or add "Agent Prompts" section, or surface prompts under "AI Tools" as a sub-section.

Recommendation: Add "General" (通用) as first nav item. Keep "AI Tools" for agent configs + CLI verification. Add "Prompts" (提示词) as a separate nav item for the CRUD UI. This aligns with the milestone description's explicit separation of concerns.

### Prompt Selection in Task Creation

`CreateTaskDialog` currently accepts no prompt-related props. Changes needed:
1. Add `prompts?: AgentPromptOption[]` prop to `CreateTaskDialogProps`
2. Add `promptId` to local state (default to the `isDefault` prompt's id)
3. Add a Select or compact list UI to the dialog form
4. Add `promptId?: string` to `onSubmit` payload type
5. Update `createTask` server action to accept and store `promptId`

The `Task.promptId` field already exists in the Prisma schema — no migration needed.

---

## Sources

- Codebase analysis: existing `src/lib/adapters/types.ts`, `src/lib/adapters/claude-local/test.ts`, `src/actions/prompt-actions.ts`, `src/actions/agent-config-actions.ts`, `src/components/settings/`, `src/lib/i18n.tsx`, `prisma/schema.prisma`
- Milestone goal: `.planning/PROJECT.md` — "通用设置、AI 工具接入验证和 Agent 提示词管理"
- Standard patterns: next-themes, Tailwind CSS dark mode (training data, HIGH confidence for well-established conventions)

---
*Feature research for: Settings page — AI task management tool (localhost)*
*Researched: 2026-03-26*
