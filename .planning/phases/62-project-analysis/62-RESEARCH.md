# Phase 62: Project Analysis - Research

**Researched:** 2026-04-21
**Domain:** Claude CLI one-shot analysis, Next.js Server Actions, base-ui Tooltip, i18n
**Confidence:** HIGH

## Summary

Phase 62 adds a "生成描述" button to the create-project and import-project dialogs. When clicked, the button invokes Claude CLI via `execFile` (one-shot, non-interactive) to analyze the project's local directory and auto-fills the description textarea with structured Markdown output.

The pattern is already well-established in this codebase. `src/lib/claude-session.ts` already uses `execFile("claude", ["-p", prompt, "--no-session-persistence", "--max-turns", "1"], ...)` for exactly this type of synchronous analysis. The new server action follows the same approach with a directory-analysis prompt. The UI pattern (disabled button + base-ui Tooltip render prop + loading spinner + Sonner toast) is confirmed from `mission-card.tsx` and `ui.md` rules.

The main implementation work is: (1) new server action `analyzeProjectDirectory(localPath)` that spawns Claude CLI with a structured prompt, (2) "生成描述" button added to both dialog components, (3) three new i18n keys in both zh.ts and en.ts.

**Primary recommendation:** Follow the `generateSummaryFromLog` pattern from `claude-session.ts` exactly — `execFile("claude", ["-p", prompt, "--no-session-persistence", "--max-turns", "1"], { cwd, timeout: 30_000 })` — and place the new server action in `src/actions/project-actions.ts`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Create form: "生成描述" button appears next to the clone button (below localPath area)
- Import form: "生成描述" button appears below the localPath field
- Button disabled (greyed out) when localPath is empty or project not yet cloned
- Disabled state shows tooltip "请先选择路径" on hover
- Loading indicator on button during analysis (spinner icon + text change)
- Use a server action (not API route) for the analysis — consistent with existing action patterns
- The server action spawns `claude` CLI with a specific prompt to analyze the directory
- Analysis prompt instructs Claude to read package.json, README, src/ structure, detect monorepo
- Output format: structured Markdown with tech stack, module breakdown, and MCP subPath guidance
- Use `execFile` (child_process) for one-shot analysis, NOT PTY session — this is a single request/response, not interactive
- Timeout: 30 seconds max, show error toast on timeout
- Returns structured Markdown that auto-fills the description textarea
- Format includes: tech stack, main modules/packages, entry points, and optional MCP subPath suggestions
- User can edit the generated description before submitting

### Claude's Discretion
- Exact prompt wording for the Claude CLI analysis call
- Whether to cache analysis results for the same localPath
- Error handling UX details (retry button vs just toast)
- Whether to use `claude --print` flag or pipe stdout

### Deferred Ideas (OUT OF SCOPE)
- startCommand / startPort / packageManager / workDir fields on Project (deferred to Preview milestone)
- Preview functionality (deferred to separate milestone)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANALYZE-01 | "生成描述" button appears next to clone button and below import localPath field | Button placement documented: create-project-dialog.tsx line 167–194 (clone button area), import-project-dialog.tsx below localPath div |
| ANALYZE-02 | Button disabled (greyed out) with tooltip "请先选择路径" when no localPath is set or project not cloned | base-ui Tooltip with render prop pattern confirmed; disable condition: `!localPath.trim()` in create dialog, `!localPath` in import dialog |
| ANALYZE-03 | Clicking button invokes Claude CLI to analyze localPath directory structure | execFile pattern confirmed from claude-session.ts; new server action in project-actions.ts |
| ANALYZE-04 | Analysis result auto-fills project description textarea with structured Markdown | State setter `setProjectDesc(result)` in each dialog; output prompt design in Server Architecture section |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `child_process.execFile` | Node built-in | Spawn Claude CLI one-shot | Already used in `claude-session.ts` for same purpose |
| `@base-ui/react/tooltip` | project version | Disabled-button tooltip | Already installed; tooltip.tsx wraps it |
| `sonner` | project version | Error/loading toasts | Project standard toast library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | project version | Sparkles + Loader2 icons for button | Already used in dialogs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| execFile | PTY session | PTY is interactive; overkill for one-shot analysis — execFile correct choice |
| server action | API route | Server actions are the project convention; consistent with all other actions |

**Installation:** No new packages required. All dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── actions/
│   └── project-actions.ts      # Add analyzeProjectDirectory() here
├── components/project/
│   ├── create-project-dialog.tsx   # Add button + state
│   └── import-project-dialog.tsx   # Add button + state
└── lib/i18n/
    ├── zh.ts                    # Add 3 new keys
    └── en.ts                    # Add 3 new keys
```

### Pattern 1: execFile One-Shot Claude CLI (HIGH confidence)
**What:** Spawn `claude -p <prompt> --no-session-persistence --max-turns 1` via `execFile` for read-only analysis
**When to use:** Any time you need a single-turn Claude response without creating a PTY session
**Example:**
```typescript
// Source: src/lib/claude-session.ts (verified)
execFile(
  "claude",
  ["-p", prompt, "--no-session-persistence", "--max-turns", "1"],
  {
    cwd,
    timeout: 30_000,
    encoding: "utf-8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      TMPDIR: process.env.TMPDIR,
      TERM: process.env.TERM,
    },
  },
  (err, stdout) => {
    if (err) { /* handle timeout or error */ resolve(null); return; }
    resolve(stdout.trim());
  }
);
```

### Pattern 2: base-ui Tooltip on Disabled Button (HIGH confidence)
**What:** Wrap a disabled Button in Tooltip using the render prop pattern
**When to use:** Any button that needs tooltip support including disabled state — base-ui Tooltip works on disabled elements when using render prop
**Example:**
```typescript
// Source: src/components/missions/mission-card.tsx (verified)
<Tooltip>
  <TooltipTrigger
    render={
      <Button
        disabled={!localPath.trim()}
        onClick={handleAnalyze}
        className="gap-1.5 text-xs ..."
      />
    }
  >
    {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
    {isAnalyzing ? t("project.analyzing") : t("project.genDesc")}
  </TooltipTrigger>
  <TooltipContent>{t("project.genDescDisabledTooltip")}</TooltipContent>
</Tooltip>
```

**Critical:** The tooltip renders even when button is disabled because the trigger wraps the button via render prop — base-ui handles pointer events on the wrapper, not the inner element.

**Note from STATE.md:** Use `render` prop pattern (not `asChild`) — this is the confirmed project convention from Phase 61.

### Pattern 3: Server Action for CLI Analysis
**What:** `"use server"` async function in `project-actions.ts` that wraps `execFile` in a Promise
**When to use:** Any server-side CLI invocation from a client component
**Example:**
```typescript
// Location: src/actions/project-actions.ts
"use server";
import { execFile } from "child_process";

export async function analyzeProjectDirectory(localPath: string): Promise<string> {
  // Validate input — security rule: validate at boundaries
  if (!localPath || typeof localPath !== "string") {
    throw new Error("无效的本地路径");
  }
  if (localPath.startsWith("~")) {
    throw new Error("不支持 ~ 别名，请提供绝对路径");
  }

  return new Promise((resolve, reject) => {
    const prompt = `/* designed by planner */`;
    execFile(
      "claude",
      ["-p", prompt, "--no-session-persistence", "--max-turns", "1"],
      {
        cwd: localPath,
        timeout: 30_000,
        encoding: "utf-8",
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER,
          TMPDIR: process.env.TMPDIR,
          TERM: process.env.TERM,
        },
      },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}
```

### Pattern 4: Button Loading State (HIGH confidence)
**What:** Local `isAnalyzing` boolean state, spinner icon replaces action icon during loading
**When to use:** Async button actions in dialogs
**Example:**
```typescript
const [isAnalyzing, setIsAnalyzing] = useState(false);

const handleAnalyze = async () => {
  if (!localPath.trim() || isAnalyzing) return;
  setIsAnalyzing(true);
  try {
    const result = await analyzeProjectDirectory(localPath.trim());
    setProjectDesc(result);
  } catch (err) {
    toast.error(t("project.analyzeError"));
  } finally {
    setIsAnalyzing(false);
  }
};
```

### Anti-Patterns to Avoid
- **Using PTY/createSession for analysis:** PTY is interactive — execFile is correct for one-shot
- **Using `asChild` on TooltipTrigger:** Project uses `render` prop pattern (confirmed STATE.md Phase 61 decision)
- **Mutating `process.env`:** Security rule — pass env via the `env` option in execFile options object
- **Passing full `process.env`:** Only pass the minimal env keys (PATH, HOME, USER, TMPDIR, TERM) as shown in claude-session.ts

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI invocation | Custom subprocess wrapper | `execFile` from Node built-in | Already established; handles encoding, timeout, error |
| Tooltip on disabled | Custom hover handler | base-ui TooltipPrimitive with render prop | Project convention; handles accessibility |
| Toast notifications | Custom alert UI | `toast.error()` / `toast.success()` from sonner | Project standard |

**Key insight:** The entire server-side pattern (`execFile` + Promise wrap + env handling) is already implemented in `claude-session.ts` — the new action is a direct adaptation of `generateSummaryFromLog`.

---

## Common Pitfalls

### Pitfall 1: Tooltip Not Showing on Disabled Button
**What goes wrong:** Tooltip doesn't appear when hovering over a disabled button
**Why it happens:** Disabled buttons suppress pointer events — the tooltip trigger never fires
**How to avoid:** Use the `render` prop on `TooltipTrigger` (confirmed pattern from mission-card.tsx). The render prop makes the TooltipTrigger the outer element, which receives pointer events even when the inner button is disabled.
**Warning signs:** Tooltip appears on enabled state but vanishes when disabled

### Pitfall 2: Timeout Error Not Caught
**What goes wrong:** execFile timeout throws an `Error` with `code: 'ERR_CHILD_PROCESS_KILLED'` — if not caught, the server action throws unhandled
**Why it happens:** Node's execFile kills the process after `timeout` ms with SIGTERM
**How to avoid:** The `(err, stdout)` callback receives the error — reject the Promise; catch in the client with `try/catch` around the server action call; show `toast.error(t("project.analyzeError"))`

### Pitfall 3: Process env Pollution
**What goes wrong:** Claude CLI subprocess inherits all parent env vars including sensitive ones like NODE_OPTIONS, DATABASE_URL, etc.
**Why it happens:** Passing `process.env` directly to execFile options
**How to avoid:** Only pass the minimal env keys: `PATH, HOME, USER, TMPDIR, TERM` — exactly as done in `generateSummaryFromLog`

### Pitfall 4: Button Placement in Create Dialog — Conditional Rendering
**What goes wrong:** The clone button area in `create-project-dialog.tsx` is already conditionally rendered (`{gitUrl.trim() && localPath.trim() && (...)}`). Placing the analyze button in the wrong location means it only appears when clone section is visible.
**Why it happens:** The clone section is gated on both `gitUrl` and `localPath` having values
**How to avoid:** Per CONTEXT.md decisions — the analyze button should appear "next to the clone button". This means it belongs **inside** the same conditional wrapper, or in a separate wrapper that only gates on `localPath`. Verify with the locked decision: disabled when `localPath` is empty — so the button should be visible whenever localPath has a value, with disabled state when not cloned yet. Place it in a wrapper gated on `localPath.trim()` only, not requiring gitUrl.

### Pitfall 5: i18n Key Missing on TypeScript Build
**What goes wrong:** TypeScript compile error because `t("project.genDesc")` key not in `TranslationKey` type
**Why it happens:** `types.ts` is derived from the zh keys — adding a key to zh.ts without matching en.ts causes type mismatch
**How to avoid:** Add all new keys to BOTH `zh.ts` and `en.ts` simultaneously

---

## Code Examples

Verified patterns from official sources:

### execFile with timeout (from claude-session.ts)
```typescript
// Source: src/lib/claude-session.ts:124-143 (verified)
execFile(
  "claude",
  ["-p", prompt, "--no-session-persistence", "--max-turns", "1"],
  {
    cwd,
    timeout: 30_000,
    encoding: "utf-8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, TMPDIR: process.env.TMPDIR, TERM: process.env.TERM },
  },
  (err, stdout) => {
    if (err) { resolve(null); return; }
    const result = stdout.trim();
    resolve(result || null);
  }
);
```

### Tooltip render prop on button (from mission-card.tsx)
```typescript
// Source: src/components/missions/mission-card.tsx:123-139 (verified)
<Tooltip>
  <TooltipTrigger
    render={
      <Button
        variant="ghost"
        className="h-8 w-8 p-0 ml-1 shrink-0"
        onClick={handler}
        disabled={condition}
      />
    }
  >
    <Icon className="h-3.5 w-3.5" />
  </TooltipTrigger>
  <TooltipContent>{t("some.key")}</TooltipContent>
</Tooltip>
```

### Toast error pattern (from import-project-dialog.tsx)
```typescript
// Source: src/components/project/import-project-dialog.tsx (verified)
import { toast } from "sonner";
toast.success(t("project.migrateSuccess"));
toast.error(someMessage);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `asChild` on TooltipTrigger | `render` prop | Phase 61 | base-ui API differs from shadcn/radix |
| `delayDuration` | `delay` on TooltipProvider | Phase 61 | base-ui prop name |

---

## New i18n Keys Required

Three new keys must be added to both `zh.ts` and `en.ts`:

| Key | zh value | en value |
|-----|----------|----------|
| `project.genDesc` | `生成描述` | `Generate Description` |
| `project.analyzing` | `分析中...` | `Analyzing...` |
| `project.analyzeError` | `分析失败，请重试` | `Analysis failed, please retry` |
| `project.genDescDisabledTooltip` | `请先选择路径` | `Please select a path first` |

Note: `project.genDescDisabledTooltip` maps to the locked decision tooltip text "请先选择路径". Four keys total.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI | `analyzeProjectDirectory` server action | ✓ | 2.1.87 (Claude Code) | — (required; users have it if they use Tower) |
| Node.js `child_process` | execFile | ✓ | v22.17.0 | — (built-in) |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

> workflow.nyquist_validation not explicitly set to false — validation section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANALYZE-03 | `analyzeProjectDirectory` validates localPath, rejects tilde paths, returns CLI output | unit | `pnpm test:run src/actions/__tests__/project-analysis.test.ts` | ❌ Wave 0 |
| ANALYZE-03 | timeout error propagates correctly | unit | same file | ❌ Wave 0 |
| ANALYZE-02 | button is disabled when localPath empty | manual (UI component test) | manual | N/A |
| ANALYZE-04 | description textarea filled after analysis | manual (UI component test) | manual | N/A |

**Note:** ANALYZE-01, ANALYZE-02, ANALYZE-04 are UI interaction behaviors best verified by manual smoke test in dev. The testable core is the server action logic.

### Sampling Rate
- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/actions/__tests__/project-analysis.test.ts` — covers ANALYZE-03 (input validation, timeout error, env isolation)

---

## Open Questions

1. **Tooltip visible when button is disabled but localPath is empty (create dialog)**
   - What we know: In create dialog, the clone area is conditionally shown only when `gitUrl && localPath` both have values. If we gate the analyze button the same way, it won't appear without gitUrl. But the CONTEXT.md says "disabled when localPath is empty or project not yet cloned."
   - What's unclear: Should the analyze button appear even without a gitUrl (i.e., for non-git projects that just have a localPath)?
   - Recommendation: Show the analyze button whenever `localPath.trim()` is non-empty (regardless of gitUrl), with disabled state when empty. This aligns with import dialog behavior and the disabled-tooltip pattern. For create dialog, add a separate conditional `{localPath.trim() && (...analyze button...)}` outside the clone button's gitUrl gate.

2. **Cache results for same localPath**
   - What we know: CONTEXT.md marks this as Claude's Discretion
   - What's unclear: Whether caching adds sufficient value vs. complexity
   - Recommendation: Skip caching in initial implementation — analysis takes ~5-10s, user can re-click if needed. Keep it simple.

3. **Exact analysis prompt wording**
   - What we know: CONTEXT.md marks this as Claude's Discretion; must cover package.json, README, src/, monorepo detection, MCP subPath guidance
   - Recommendation: Design in PLAN.md with a specific prompt template instructing Claude to output structured Markdown

---

## Sources

### Primary (HIGH confidence)
- `src/lib/claude-session.ts` — execFile pattern, env isolation, timeout handling (verified by direct read)
- `src/components/missions/mission-card.tsx` — Tooltip render prop pattern on Button (verified)
- `src/components/project/create-project-dialog.tsx` — create dialog structure (verified)
- `src/components/project/import-project-dialog.tsx` — import dialog structure (verified)
- `src/components/ui/tooltip.tsx` — base-ui Tooltip API (verified)
- `src/lib/i18n/zh.ts` — existing i18n keys (verified)
- `.planning/STATE.md` — Phase 61 decisions: render prop pattern, delay prop, tilde guard

### Secondary (MEDIUM confidence)
- `src/actions/project-actions.ts` — server action file structure for new action placement
- `.claude/rules/ui.md` — loading state pattern, button sizing, toast conventions
- `.claude/rules/security.md` — input validation, no process.env mutation

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on This Phase |
|-----------|---------------------|
| Use `pnpm` for package manager | All install/run commands use pnpm |
| All user-facing text via `t("key")` | 4 new i18n keys required in zh.ts + en.ts |
| Next.js 15+ async params | Not relevant (no route params in dialogs) |
| App Router: `export const runtime = "nodejs"` | Not relevant (server action, not route) |
| Security: validate at boundaries, no process.env mutation | analyzeProjectDirectory must validate localPath; execFile env must be minimal set |
| `execFile` env: pass only PATH, HOME, USER, TMPDIR, TERM | Critical — do not pass full process.env |
| Sonner for toasts | `toast.error()` on timeout/failure |
| base-ui Tooltip render prop (not asChild) | Confirmed by STATE.md Phase 61 decision |
| Button default size (h-8 = 32px) | Generate description button uses default size |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in project, verified by direct file reads
- Architecture: HIGH — pattern directly borrowed from existing `generateSummaryFromLog` in claude-session.ts
- Pitfalls: HIGH — verified from existing code and Phase 61 decisions in STATE.md
- UI placement: HIGH — read both target components in full

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable — project conventions won't change)
