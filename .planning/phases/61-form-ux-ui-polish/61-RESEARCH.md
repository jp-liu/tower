# Phase 61: Form UX & UI Polish - Research

**Researched:** 2026-04-21
**Domain:** React/Next.js form component surgery + CSS overflow constraints + layout relocation
**Confidence:** HIGH

## Summary

Phase 61 is pure UI surgery — no new libraries, no backend schema changes. All six requirements (FORM-01 through FORM-05, UI-01) target existing components with surgical edits. The code was read directly from the repository, so every finding below is HIGH confidence based on the live source.

The core pattern across all tasks: find the offending JSX element, apply one targeted class or prop change, and add or remove adjacent JSX nodes. The only mildly complex change is FORM-05 (tilde validation), which requires both a frontend warning label and a backend guard in `resolveGitLocalPath`.

**Primary recommendation:** Work component-by-component in a single wave. No architecture changes needed; all changes fit within existing file boundaries.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Path Input Modes**
- Create project ("新建项目"): Remove browse button, make localPath a plain text Input (editable) — user types path manually after gitUrl auto-resolves it
- Import project ("导入项目"): Keep browse button, make localPath read-only after selection (disable Input or use readOnly prop)
- Migration ("迁移"): Target path field remains editable text Input (already using Input, just ensure not disabled)

**Textarea Overflow**
- Apply `max-h-[200px] overflow-y-auto` to all project description and task description textareas
- Use CSS on the textarea element directly (not wrapping div) — prevents dialog from growing beyond viewport
- Applies to: CreateProjectDialog description, ImportProjectDialog description, CreateTaskDialog description

**Path Validation**
- Frontend: Show warning label below clone directory input when value starts with `~` — text "请输入绝对路径，不支持 ~ 别名"
- Backend: resolveGitLocalPath action rejects paths starting with ~ and returns validation error
- Only applies to the clone directory setting (not project localPath which is auto-resolved)

**Assistant Icon Relocation**
- Move Bot icon from current position (near language toggle/settings) to right side of search box in top-bar
- Keep same icon (Bot from lucide-react), same ghost button style, same click behavior (open assistant panel)
- Position: immediately after the search trigger button, before the settings/language area

### Claude's Discretion
- Exact spacing between search box and assistant icon
- Whether to show tooltip on hover for assistant icon
- Internal refactoring of form state management if needed for cleaner implementation

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FORM-01 | User can create project with plain text path input (no browse button), path is editable | Browse Button removal in `create-project-dialog.tsx` lines 162-169; Input remains with onChange handler |
| FORM-02 | User can import project via browse dialog, selected localPath is read-only (not editable) | `import-project-dialog.tsx` already has `readOnly` on the Input (line 215); confirm it stays that way |
| FORM-03 | User can migrate project with editable target path | `import-project-dialog.tsx` targetPath Input (lines 263-271) has no `readOnly`/`disabled` — already correct; verify |
| FORM-04 | Project description and task description textarea have max-height with overflow-y scroll | All three dialogs use raw `<textarea>` or shadcn `<Textarea>` with no height cap — add `max-h-[200px] overflow-y-auto` |
| FORM-05 | Git cloneDir setting shows warning text and backend rejects paths starting with ~ | Frontend: add conditional `<p>` below localPath Input in `create-project-dialog.tsx`; Backend: guard in `resolveGitLocalPath` |
| UI-01 | Assistant chat icon moved from language toggle area to right side of search box in header | In `top-bar.tsx` move the `<button>` (lines 66-75) from inside "Right Actions" div to immediately after the search `<button>` (line 61) |
</phase_requirements>

---

## Standard Stack

### Core (all pre-installed — no new installs needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | Component rendering | Project baseline |
| TailwindCSS | 4.x | Utility-first CSS | Project baseline |
| shadcn/ui (Input, Textarea, Button) | project-local | Form primitives | Project design system |
| lucide-react | project-installed | Icons (Bot) | Already imported in top-bar |

**No new packages needed for this phase.**

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `max-h-[200px] overflow-y-auto` on textarea | wrapping div | CONTEXT.md locks textarea-direct approach |
| Moving Bot button JSX | creating new component | JSX move is simpler; no abstraction needed |

---

## Architecture Patterns

### Recommended Project Structure
No new files or directories needed. All changes happen inside:
```
src/
├── components/
│   ├── project/
│   │   ├── create-project-dialog.tsx   # FORM-01, FORM-05 (frontend)
│   │   └── import-project-dialog.tsx   # FORM-02, FORM-03, FORM-04
│   ├── board/
│   │   └── create-task-dialog.tsx      # FORM-04
│   └── layout/
│       └── top-bar.tsx                 # UI-01
├── actions/
│   └── config-actions.ts              # FORM-05 (backend)
└── lib/i18n/
    ├── zh.ts                           # new key: "project.tildeWarning"
    └── en.ts                           # new key: "project.tildeWarning"
```

### Pattern 1: Browse Button Removal (FORM-01)

**What:** Delete the `<Button>` node for "Browse" in `create-project-dialog.tsx` and unwrap the surrounding flex div.

**Current code (lines 155-170):**
```tsx
<div className="mt-1.5 flex gap-2">
  <Input
    placeholder={t("project.localPathPlaceholder")}
    value={localPath}
    onChange={(e) => handleLocalPathChange(e.target.value)}
    className="flex-1 font-mono text-xs"
  />
  <Button
    type="button"
    variant="outline"
    onClick={() => setShowFolderBrowser(true)}
    className="shrink-0"
  >
    {t("folder.browse")}
  </Button>
</div>
```

**After change:**
```tsx
<Input
  placeholder={t("project.localPathPlaceholder")}
  value={localPath}
  onChange={(e) => handleLocalPathChange(e.target.value)}
  className="mt-1.5 font-mono text-xs"
/>
```

Also remove the `<FolderBrowserDialog>` at the bottom and the `showFolderBrowser` state variable (they become unreferenced).

### Pattern 2: Read-Only Import Path (FORM-02)

**What:** The `import-project-dialog.tsx` Input at line 215 already has `readOnly` and `bg-muted/30`. No functional change needed — verify visually that it cannot be typed into. The `FolderBrowserDialog` calls `handleFolderSelect` which sets localPath. This is already correct.

**Verification-only task** — read code and confirm no regression introduced.

### Pattern 3: Editable Migration Target Path (FORM-03)

**What:** `import-project-dialog.tsx` lines 263-271 — the `targetPath` Input has `onChange` but no `readOnly` or `disabled`. **Already correct.** Confirm `isConfirmDisabled` condition (line 194) doesn't accidentally gate on targetPath being read-only.

**Verification-only task** — no code changes needed.

### Pattern 4: Textarea Max-Height (FORM-04)

Three locations to patch — add `max-h-[200px] overflow-y-auto` to the className on the textarea element directly:

**create-project-dialog.tsx line 248:**
```tsx
// Before
className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ... resize-none"
// After
className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ... resize-none max-h-[200px] overflow-y-auto"
```

**import-project-dialog.tsx line 344 (same pattern):**
```tsx
className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ... resize-none max-h-[200px] overflow-y-auto"
```

**create-task-dialog.tsx — uses shadcn `<Textarea>` (lines 204-210):**
```tsx
<Textarea
  id="description"
  placeholder={t("task.descPlaceholder")}
  rows={4}
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  className="max-h-[200px] overflow-y-auto"
/>
```

Note: The shadcn Textarea component uses `field-sizing-content` which auto-grows. Adding `max-h-[200px]` caps the growth. The `overflow-y-auto` shows scrollbar only when content exceeds the cap.

### Pattern 5: Tilde Warning (FORM-05)

**What:** FORM-05 targets the **clone directory** (the localPath field in `create-project-dialog.tsx` that is auto-resolved from the git URL). When the user manually overrides this path and types something starting with `~`, show a warning.

**Frontend change in `create-project-dialog.tsx`:**
```tsx
{/* After the localPath Input and before the clone button section */}
{localPath.startsWith("~") && (
  <p className="mt-1 text-[11px] text-amber-400">
    {t("project.tildeWarning")}
  </p>
)}
```

**Backend change in `config-actions.ts` — `resolveGitLocalPath`:**
```typescript
export async function resolveGitLocalPath(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return "";
  // Note: the auto-resolved path may internally use expandHome (via gitUrlToLocalPath),
  // but that is controlled code. The tilde rejection is for user-entered clone paths,
  // validated at the /api/git clone endpoint or at form submit time.
  // ...existing logic unchanged
}
```

**Important clarification from code reading:** `resolveGitLocalPath` auto-resolves a path FROM a git URL — it uses `expandHome` internally. The tilde rejection applies to the path the user types manually in the localPath field of `create-project-dialog.tsx`. The rejection should happen at the clone action (POST /api/git) or in a new server action validation — NOT inside `resolveGitLocalPath` itself (which does the URL→path resolution, not user input validation).

**Correct approach for backend:** Add tilde check in the `/api/git` clone handler (`route.ts` line ~119) before `expandHome` is called, OR add a separate validation server action. The `/api/git` route already calls `expandHome(clonePath)` — add an early return before that:

```typescript
// In POST /api/git route, before expandHome:
if (clonePath.startsWith("~")) {
  return NextResponse.json(
    { error: "请输入绝对路径，不支持 ~ 别名" },
    { status: 400 }
  );
}
```

This means the clone button call will get a 400 and display the error in the existing `cloneError` state.

### Pattern 6: Assistant Icon Relocation (UI-01)

**What:** In `top-bar.tsx`, the Bot button is currently at lines 66-75, inside the right-side `<div className="flex items-center gap-1.5">`. Move it to be a sibling of the search button, immediately after it.

**Current layout structure:**
```
<header>
  <div className="w-40" />          ← left spacer
  <button>search</button>           ← center search
  <div className="flex ...">        ← right actions
    <button>Bot</button>            ← CURRENTLY HERE
    <button>Language</button>
    <div>divider</div>
    <Link>Settings</Link>
    <Button>Import</Button>
    <Button>New</Button>
    <Avatar />
  </div>
</header>
```

**After relocation:**
```
<header>
  <div className="w-40" />
  <div className="flex items-center gap-2">   ← new wrapper
    <button>search</button>
    <button>Bot</button>                       ← MOVED HERE
  </div>
  <div className="flex ...">                  ← right actions (Bot removed)
    <button>Language</button>
    <div>divider</div>
    ...
  </div>
</header>
```

The header uses `justify-between` so wrapping search+bot together keeps them centered as a unit.

**Ghost button style to preserve (from `.claude/rules/ui.md`):**
```tsx
className="h-8 w-8 p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
```

Current bot button uses slightly different classes (`rounded-lg p-2`) — the discretion note allows us to align it with the standard ghost icon button pattern for consistency.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Max-height scrollable textarea | Custom JS scroll | `max-h-[200px] overflow-y-auto` CSS | Browser native scroll handles all edge cases |
| Tilde detection | Regex | `value.startsWith("~")` | Simple string prefix check is sufficient |
| Warning label component | Shared component | Inline `<p>` with amber color | One-off pattern, not worth abstracting |

**Key insight:** This phase is CSS and JSX surgery. Custom JS behavior would add unnecessary complexity.

---

## Common Pitfalls

### Pitfall 1: field-sizing-content conflicts with max-height
**What goes wrong:** The shadcn Textarea uses `field-sizing-content` (auto-grow). Adding `max-h-[200px]` may not cap growth in all browsers if `overflow` is not set.
**Why it happens:** `field-sizing-content` and `max-height` interact differently across browsers.
**How to avoid:** Always pair `max-h-[200px]` with `overflow-y-auto` on the same element. This is locked in CONTEXT.md.
**Warning signs:** Dialog keeps growing in Firefox/Safari — test in multiple browsers.

### Pitfall 2: Removing browse button leaves unreferenced state
**What goes wrong:** `showFolderBrowser` state and `<FolderBrowserDialog>` JSX become dead code after removing the browse button from `create-project-dialog.tsx`.
**Why it happens:** State and the dialog component both reference each other but neither is removed.
**How to avoid:** When removing the Browse Button, also remove: `showFolderBrowser` state (line 47), the `<FolderBrowserDialog>` block (lines 267-273), and the `FolderBrowserDialog` import if no longer used.
**Warning signs:** TypeScript will not warn about unused state; only a manual check catches it.

### Pitfall 3: `resolveGitLocalPath` uses expandHome internally
**What goes wrong:** Adding a tilde check to `resolveGitLocalPath` would break the auto-resolution logic, because the function internally produces paths via `expandHome` which starts with `~` during intermediate steps.
**Why it happens:** `gitUrlToLocalPath` calls `expandHome` to produce the final expanded path.
**How to avoid:** The tilde validation belongs in the `/api/git` clone route or at form submit, NOT in `resolveGitLocalPath`. The auto-resolved localPath value (which may start with `~` before expansion) is handled by server-side expandHome — the warning should only fire when the user manually types a `~` path.
**Warning signs:** Auto-filled paths showing warning incorrectly when user hasn't typed anything.

### Pitfall 4: Top bar layout shift when moving Bot button
**What goes wrong:** Moving the Bot button out of the right `gap-1.5` flex group and placing it after the standalone search button may change the spacing model.
**Why it happens:** The search button is a standalone element; wrapping it with the Bot button in a `flex` div changes how `justify-between` distributes the three header children.
**How to avoid:** Wrap search + bot in a single `<div className="flex items-center gap-2">` to preserve the three-column layout (left spacer, center, right actions).
**Warning signs:** Search box drifts off-center.

### Pitfall 5: FORM-02 import path already read-only — verify no regressions
**What goes wrong:** `import-project-dialog.tsx` already has `readOnly` on the localPath Input. A refactor pass might accidentally remove it.
**Why it happens:** Copy-paste edits or merge conflicts.
**How to avoid:** The FORM-02 task should read the file first and confirm `readOnly` is present, rather than "adding" it (it's already there).

---

## Code Examples

### Tilde Warning Pattern (FORM-05 frontend)
```tsx
// Source: CONTEXT.md locked decision + project i18n pattern
{localPath.trim().startsWith("~") && (
  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-400">
    <AlertCircle className="h-3 w-3" />
    {t("project.tildeWarning")}
  </p>
)}
```

### Textarea Max-Height (FORM-04 — raw textarea)
```tsx
// Source: CONTEXT.md locked decision
className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 resize-none max-h-[200px] overflow-y-auto"
```

### Textarea Max-Height (FORM-04 — shadcn Textarea component)
```tsx
// Source: CONTEXT.md locked decision
<Textarea
  rows={4}
  className="max-h-[200px] overflow-y-auto"
  {...otherProps}
/>
```

### Bot Button Standard Style (UI-01)
```tsx
// Source: .claude/rules/ui.md — Icon Buttons pattern
<button
  onClick={toggleAssistant}
  aria-label={t("assistant.iconLabel")}
  className={[
    "h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground flex items-center justify-center",
    assistantOpen ? "bg-accent text-foreground" : "",
  ].join(" ")}
>
  <Bot className="h-4 w-4" />
</button>
```

### i18n Key Additions
```typescript
// zh.ts — add to project section
"project.tildeWarning": "请输入绝对路径，不支持 ~ 别名",

// en.ts — add to project section
"project.tildeWarning": "Please enter an absolute path. ~ alias is not supported.",
```

### Backend Tilde Rejection (FORM-05 — /api/git/route.ts)
```typescript
// Source: current route.ts POST handler, before expandHome call
if (action === "clone") {
  const { url, path: clonePath } = body;
  if (!url || !clonePath) {
    return NextResponse.json({ error: "url and path required" }, { status: 400 });
  }
  // Reject ~ paths
  if (typeof clonePath === "string" && clonePath.startsWith("~")) {
    return NextResponse.json(
      { error: "请输入绝对路径，不支持 ~ 别名" },
      { status: 400 }
    );
  }
  const resolved = path.resolve(expandHome(clonePath));
  // ...rest of clone logic
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `<textarea>` without height cap | `max-h-[200px] overflow-y-auto` | Phase 61 | Dialogs no longer overflow viewport |
| Browse button in create-project | Plain text input | Phase 61 | Clearer UX for create vs import flows |
| Bot icon near language toggle | Bot icon next to search box | Phase 61 | Consistent placement, discoverable |

---

## Open Questions

1. **FORM-05 scope: does the warning apply to the auto-filled path value?**
   - What we know: `handleLocalPathChange` is called when user types; `handleGitUrlChange` sets `localPath` via `resolveGitLocalPath` (server-side expandHome)
   - What's unclear: Should the warning fire if the auto-resolved path happens to start with `~`? (In practice `expandHome` expands `~` to absolute, so auto-resolved paths won't start with `~`)
   - Recommendation: Only fire warning when `localPathManual === true` AND value starts with `~`. This avoids false positives from any edge case in auto-resolution.

2. **FORM-03 confirmation: migration path already editable?**
   - What we know: Code review shows no `readOnly` or `disabled` on targetPath Input
   - What's unclear: Whether user has seen actual UI behavior
   - Recommendation: The FORM-03 plan task should be a verification task that reads the file, confirms editable state, and adds a test assertion — no code changes expected.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely client-side component edits and a single server action guard. No external tools, databases, or runtimes beyond the existing Next.js/Node.js stack.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (project-standard) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FORM-01 | create-project-dialog renders without browse button | unit/component | `pnpm test:run -- create-project` | ❌ Wave 0 |
| FORM-02 | import-project localPath Input has readOnly | unit/component | `pnpm test:run -- import-project` | ❌ Wave 0 |
| FORM-03 | migration targetPath Input is editable | unit/component | `pnpm test:run -- import-project` | ❌ Wave 0 |
| FORM-04 | textareas have max-h-[200px] class | unit/component | `pnpm test:run -- create-project\|create-task` | ❌ Wave 0 |
| FORM-05 frontend | tilde warning shows when path starts with ~ | unit/component | `pnpm test:run -- create-project` | ❌ Wave 0 |
| FORM-05 backend | /api/git clone rejects ~ paths | integration | `pnpm test:run -- git` | ❌ Wave 0 |
| UI-01 | Bot button renders after search in DOM order | unit/component | `pnpm test:run -- top-bar` | ❌ Wave 0 |

**Note:** These are UI component tests. Given project testing patterns lean toward action/server-side tests (all existing tests are for actions, MCP tools, and hooks — not dialog components), UI component tests may be manual-only verification. The planner should assess whether the project's test setup includes JSDOM/React Testing Library.

### Sampling Rate
- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Component tests for dialog components would require React Testing Library + JSDOM setup — check if already configured before creating test files
- [ ] If component testing is not set up, tests for FORM-01 through UI-01 are manual-only

*(Existing test infrastructure covers server actions and hooks — dialog component tests are likely manual-only given the project's current test patterns)*

---

## Project Constraints (from CLAUDE.md)

| Directive | Applies To |
|-----------|------------|
| Use `t("key")` for all user-visible text | New warning text, any new labels |
| `pnpm` preferred over npm | Installing dependencies (none needed) |
| App Router: `export const runtime = "nodejs"` + `dynamic = "force-dynamic"` | Not applicable (no new routes) |
| `export const dynamic = "force-dynamic"` | Not applicable |
| Ghost icon buttons: `h-8 w-8 p-0 text-muted-foreground hover:bg-accent hover:text-foreground` | Bot button in UI-01 |
| Never use `SelectValue` | Not applicable |
| Use Sonner toast | Not applicable (no new toasts) |
| Loading states: opacity overlay pattern | Not applicable |
| DnD Kit stable id | Not applicable |
| `readOnly` not `disabled` for display-only inputs | FORM-02 localPath |

---

## Sources

### Primary (HIGH confidence)
- Direct code reading of `src/components/project/create-project-dialog.tsx` — confirmed browse button location, localPath state, FolderBrowserDialog usage
- Direct code reading of `src/components/project/import-project-dialog.tsx` — confirmed readOnly on localPath Input, targetPath Input editable
- Direct code reading of `src/components/layout/top-bar.tsx` — confirmed Bot button location (lines 66-75), header layout
- Direct code reading of `src/components/board/create-task-dialog.tsx` — confirmed shadcn Textarea usage, no max-height
- Direct code reading of `src/actions/config-actions.ts` — confirmed resolveGitLocalPath does NOT validate user input
- Direct code reading of `src/app/api/git/route.ts` — confirmed expandHome usage, clone handler location
- Direct code reading of `src/components/ui/textarea.tsx` — confirmed `field-sizing-content` class present
- Direct code reading of `.claude/rules/ui.md` — ghost icon button pattern, i18n rules

### Secondary (MEDIUM confidence)
- CSS spec: `max-h-[200px] overflow-y-auto` on textarea with `field-sizing-content` — standard browser behavior, verified by Tailwind utility definitions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all existing
- Architecture: HIGH — direct code reading, not inference
- Pitfalls: HIGH — pitfalls derived from reading actual code paths
- Test coverage: MEDIUM — component testing setup unconfirmed (existing tests are action/hook-only)

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable component code, no fast-moving dependencies)
