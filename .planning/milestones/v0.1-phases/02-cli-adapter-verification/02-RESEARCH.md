# Phase 2: CLI Adapter Verification - Research

**Researched:** 2026-03-26
**Domain:** Next.js 16 App Router, React state management, adapter testing API, i18n
**Confidence:** HIGH

## Summary

Phase 2 adds a "Test Connection" button to the AI Tools settings panel. The entire backend is already implemented: `testEnvironment()` exists in `src/lib/adapters/claude-local/test.ts`, and an API route at `POST /api/adapters/test` already wraps it with Zod validation and proper error handling. The `GET /api/adapters/test` endpoint also lists adapters. The frontend work is purely UI: a new component (or extension of `AIToolsConfig`) that calls the existing API route, manages loading/result state with `useState`, and renders `TestCheck` rows with pass/fail icons.

The key architectural decision (per Claude's Discretion in CONTEXT.md) is confirmed: **use the existing API route**, not a server action. Server actions inherit `maxDuration` from the page segment config. The 45s hello probe would exceed the default. The API route (`/api/adapters/test/route.ts`) already exists and handles this correctly — no config change needed.

The UI must never trigger the test on page mount (CONTEXT.md constraint: 45s blocking). All test state is local (`useState`) — no server revalidation is needed since this is a read-only health check with no database mutation.

**Primary recommendation:** Create a new `CLIAdapterTester` component that renders per-adapter sections within AIToolsConfig, calls `fetch('/api/adapters/test', { method: 'POST' })`, and manages `{ testing: boolean; result: TestResult | null }` state per adapter with `useState`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Show test results as a status card with a check list below the test button. Each check renders as a row with a pass/fail icon (checkmark or X) and the message string from `TestCheck`. Consistent with existing Card pattern in AIToolsConfig.
- **D-02:** When no test has been run yet, show nothing (no placeholder card). Results appear only after the user clicks Test Connection.
- **D-03:** Each registered adapter (from `listAdapters()`) gets its own section/card within the AI Tools panel. Each section shows the adapter name, a Test Connection button, and test results below.
- **D-04:** The existing agent config editor (default agent selection, append prompt) remains as-is. The test connection UI is a separate section, visually distinct — test connection is about verifying CLI availability, not configuring agent behavior.
- **D-05:** Add a version check to the test flow — run `claude --version` (or equivalent) and include the version string in the test results. Display version in the adapter section header or as an additional check row when available.
- **D-06:** Version display is best-effort. If version extraction fails, show "Version: unknown" — do not block the test.
- **D-07:** While testing, the Test Connection button shows a spinner icon and "Testing..." text. The button is disabled during the test to prevent concurrent attempts (satisfies CLIV-04 debounce requirement).
- **D-08:** No progress bar needed — the test runs as a single async operation with a loading state. The 45s timeout in the hello probe is handled server-side.

### Claude's Discretion

- Exact card layout and spacing — follow existing AIToolsConfig visual patterns
- i18n translation keys for test connection labels — follow existing naming convention
- Whether to use a server action or API route for triggering testEnvironment() — Claude can decide the best approach given the 45s timeout constraint
- Icon choices for pass/fail indicators — any clear, accessible iconography

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope (auto mode).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLIV-01 | User can trigger a live connection test for each registered AI adapter | API route `GET /api/adapters/test` lists adapters; `POST /api/adapters/test` runs test — both exist |
| CLIV-02 | Test results show per-check pass/fail status with actionable messages | `TestResult.checks: TestCheck[]` already has `name`, `passed`, `message` — render each as a row |
| CLIV-03 | Test results show CLI version information when available | `testEnvironment()` currently has no version check — a version check step must be added to `claude-local/test.ts` |
| CLIV-04 | Test button is debounced to prevent concurrent 45-second test probes | `useState` boolean `testing` flag + `disabled={testing}` on button — no library needed |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React `useState` | 19.2.4 | Loading/result state per adapter | No mutation, no server revalidation needed — pure local state |
| `fetch` (native) | browser | Call `POST /api/adapters/test` | API route already exists; server action approach has timeout risks |
| `lucide-react` | ^1.6.0 | Pass/fail/spinner icons | Already used throughout; `Check`, `X`, `Loader2` are the standard choices |
| `Card`, `CardContent`, `Button` | shadcn (project-local) | Test results card + test button | Used in `AIToolsConfig` — match visual pattern |
| `useI18n()` | project-local (`src/lib/i18n.tsx`) | All user-facing strings | Mandatory per CONTEXT.md — all new strings need `t()` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^4.3.6 | Request body validation in API route | Already used in the existing `/api/adapters/test` route |
| `child_process` (node built-in) | — | CLI version detection via `claude --version` | Used in `process-utils.ts` — version check runs same pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fetch` to API route | Server action + `maxDuration` export on page | Server action is cleaner DX but requires `export const maxDuration = 60` on settings page — API route already exists and works, no change needed |
| `useState` per-adapter | Zustand global store | No global state needed for ephemeral test results — `useState` is simpler and matches existing patterns |

**Installation:** No new packages required. All dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure

New files for this phase:

```
src/
├── components/settings/
│   └── cli-adapter-tester.tsx    # New: per-adapter test card(s)
├── lib/adapters/claude-local/
│   └── test.ts                   # Modify: add version check step
└── lib/i18n.tsx                  # Modify: add test connection translation keys
```

No new API routes or server actions needed — `/api/adapters/test` already handles both `GET` (list adapters) and `POST` (run test).

### Pattern 1: Fetch API Route for Long-Running Server Operation

**What:** Client component calls `fetch` to an API route instead of a server action, to avoid page-level `maxDuration` constraints.

**When to use:** When server-side operation can block for up to 45 seconds (hello probe timeout). Server actions inherit the page segment's `maxDuration` — changing it would require `export const maxDuration = 60` on `settings/page.tsx`, affecting all actions on that page. The API route is already in place and isolated.

**Example:**
```typescript
// Source: src/app/api/adapters/test/route.ts (existing)
// Client call pattern:
const [testing, setTesting] = useState(false);
const [result, setResult] = useState<TestResult | null>(null);

async function handleTestConnection() {
  if (testing) return; // CLIV-04 debounce
  setTesting(true);
  setResult(null);
  try {
    const res = await fetch("/api/adapters/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adapterType: "claude_local" }),
    });
    const data: TestResult = await res.json();
    setResult(data);
  } finally {
    setTesting(false);
  }
}
```

### Pattern 2: Per-Adapter State Isolation

**What:** Each adapter section maintains its own `testing` and `result` state independently. Since only one adapter is currently registered (`claude_local`), this is straightforward — a single pair of `useState` calls per adapter section.

**When to use:** When adapters are independent and test results should not cross-contaminate.

**Example:**
```typescript
// Source: pattern from existing AIToolsConfig
"use client";
import { useState } from "react";
import type { TestResult } from "@/lib/adapters/types";

interface AdapterTesterProps {
  adapterType: string;
  adapterLabel: string;
}

export function CLIAdapterTester({ adapterType, adapterLabel }: AdapterTesterProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const { t } = useI18n();
  // ... render
}
```

### Pattern 3: TestCheck Row Rendering

**What:** Render each `TestCheck` as a row with a pass/fail icon and the message string.

**When to use:** Always — this is the CLIV-02 requirement.

**Example:**
```typescript
// Source: TestCheck interface from src/lib/adapters/types.ts
{result.checks.map((check) => (
  <div key={check.name} className="flex items-start gap-2 text-sm">
    {check.passed
      ? <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
      : <X className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
    }
    <span className={check.passed ? "text-green-700" : "text-red-700"}>
      {check.message}
    </span>
  </div>
))}
```

### Pattern 4: Version Check Addition to testEnvironment()

**What:** Add a 4th check to `src/lib/adapters/claude-local/test.ts` that runs `claude --version` and captures the version string for display (D-05/D-06).

**When to use:** Runs before or after the existing 3 checks. Since command resolvability is already checked first, the version check can run right after check 1 succeeds.

**Example:**
```typescript
// Source: process-utils.ts runChildProcess pattern
const versionResult = await runChildProcess(
  `claude-version-${Date.now()}`,
  "claude",
  ["--version"],
  { cwd, env: {}, timeoutSec: 5, graceSec: 2, onLog: async () => {} }
);
const versionStr = versionResult.stdout.trim() || versionResult.stderr.trim() || "unknown";
checks.push({
  name: "claude_version",
  passed: true, // best-effort — never fail the overall test for version
  message: `Version: ${versionStr || "unknown"}`,
});
```

### Anti-Patterns to Avoid

- **Test on mount:** Never call `testEnvironment()` / the API route on page load — 45s blocking. All tests must be user-initiated (CONTEXT.md constraint, STATE.md decision).
- **Server action for test:** Server actions on `settings/page.tsx` would require `export const maxDuration = 60` and affect all actions on the page. Use the existing API route.
- **Global state for test results:** `TestResult` is ephemeral per-session UI state. Do not push to Zustand or any global store.
- **Blocking UI on version failure:** D-06 is explicit — version check failure must show "Version: unknown", not block the test result.
- **Hardcoded strings:** All user-facing labels (button text, check names, status) must use `t()` from `useI18n()`. No raw string literals in JSX.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounce concurrent test runs | Custom timer/ref debounce | `disabled={testing}` on the button | D-07 specifies button-disabled approach; simpler and correct |
| CLI process spawning | Custom child_process wrapper | `runChildProcess()` from `process-utils.ts` | Already handles PATH resolution, timeout, SIGTERM/SIGKILL, stdin |
| Version string parsing | Custom regex parser | Raw stdout trim from `claude --version` | The raw version string is sufficient for display |
| Test result persistence | LocalStorage / DB save | `useState` (ephemeral) | Results are session-only; no persistence needed |
| Adapter list discovery | Hardcode adapter names | `GET /api/adapters/test` → `listAdapters()` | Registry-driven; adding new adapters requires zero UI changes |

**Key insight:** The backend (test logic, process management, API route) is complete. This phase is almost entirely frontend composition using existing primitives.

---

## Common Pitfalls

### Pitfall 1: Server Action 45-Second Timeout

**What goes wrong:** If `testEnvironment()` is exposed as a `"use server"` action on the settings page, the hello probe may time out prematurely or throw a platform-level error before the 45s server-side timeout fires.

**Why it happens:** Next.js propagates `maxDuration` from route segment config to all server actions invoked on that page. The default `maxDuration` on Vercel and some platforms is 10-15 seconds.

**How to avoid:** Use the existing `POST /api/adapters/test` route via `fetch`. It is already isolated from the settings page segment config.

**Warning signs:** Test results show "probe timed out" very quickly (< 15s) even when `claude` responds within 45s.

### Pitfall 2: Testing on Page Mount

**What goes wrong:** Adding a `useEffect(() => { triggerTest() }, [])` causes the settings panel to immediately spawn a `claude` subprocess for 45 seconds, blocking resources every time the user opens Settings.

**Why it happens:** Easy mistake when wiring up "auto-verify on load" thinking.

**How to avoid:** Test is only invoked from the button's `onClick`. No `useEffect` should trigger the test. This is a STATE.md decision: "CLI test must be user-initiated only."

**Warning signs:** Network request to `/api/adapters/test` appears in devtools immediately after navigation to `/settings`.

### Pitfall 3: i18n Key Type Safety

**What goes wrong:** Adding new translation keys to `i18n.tsx` but referencing a key that doesn't exist in both `zh` and `en` objects — TypeScript will catch the call-site if the key is missing from `zh` (the source of truth for `TranslationKey`), but runtime will silently return the key string if only one locale is missing.

**Why it happens:** The `translations` object uses `as const`, and `TranslationKey = keyof typeof translations.zh`. A key added to `zh` but not `en` will pass type-checking but render the key string in English mode.

**How to avoid:** Always add new keys to both `zh` and `en` simultaneously. The `t()` function falls back to `key` when lookup fails — no error thrown.

**Warning signs:** English UI shows raw key strings like `settings.aiTools.testConnection`.

### Pitfall 4: `check.name` as React Key Without Uniqueness Guarantee

**What goes wrong:** Using `check.name` as the `key` prop in the check list map — if a future adapter adds two checks with the same name, React keys will collide.

**Why it happens:** `TestCheck.name` is a string, not guaranteed unique across all checks.

**How to avoid:** Use `check.name` as key (it is unique within the current claude-local adapter's 3-4 checks), but add a fallback: `key={`${adapterType}-${check.name}`}`.

### Pitfall 5: Version Check Before Command Resolvability Check

**What goes wrong:** If the version check runs before `ensureCommandResolvable`, it will spawn a process that fails with ENOENT and the error message will be less clear than check 1's explicit "command not found in PATH" message.

**Why it happens:** Inserting version check at the wrong position in `test.ts`.

**How to avoid:** Insert the version check immediately after check 1 (command resolution) succeeds — the guard `return { ok: false, checks }` on check 1 failure already prevents version check from running.

---

## Code Examples

### Existing: TestResult and TestCheck Types
```typescript
// Source: src/lib/adapters/types.ts
export interface TestResult {
  ok: boolean;
  checks: TestCheck[];
}

export interface TestCheck {
  name: string;
  passed: boolean;
  message: string;
}
```

### Existing: API Route (already implemented)
```typescript
// Source: src/app/api/adapters/test/route.ts
// POST body: { adapterType: string, cwd?: string }
// Response: TestResult (ok, checks[])
// GET response: { adapters: string[] }
export async function POST(request: NextRequest): Promise<NextResponse<TestResult>>
export async function GET(): Promise<NextResponse<{ adapters: string[] }>>
```

### Existing: Adapter Registry
```typescript
// Source: src/lib/adapters/registry.ts
export function listAdapters(): string[] // ["claude_local"]
export function getAdapter(type: string): AdapterModule
```

### Existing: Spinner Pattern (from lucide-react)
```typescript
// Source: CONTEXT.md canonical refs — standard codebase pattern
import { Loader2, Check, X } from "lucide-react";
// Spinner: <Loader2 className="h-4 w-4 animate-spin" />
// Pass:    <Check className="h-4 w-4 text-green-500" />
// Fail:    <X className="h-4 w-4 text-red-500" />
```

### New: i18n Keys to Add
```typescript
// Add to BOTH zh and en objects in src/lib/i18n.tsx:
"settings.aiTools.testConnection": "测试连接" / "Test Connection",
"settings.aiTools.testing": "测试中..." / "Testing...",
"settings.aiTools.testPassed": "检测通过" / "All checks passed",
"settings.aiTools.testFailed": "检测失败" / "Some checks failed",
"settings.aiTools.cliVerification": "CLI 验证" / "CLI Verification",
"settings.aiTools.cliVerificationDesc": "验证 AI 工具命令行是否已正确安装" / "Verify AI CLI tools are correctly installed",
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static "检测到最近使用" banner (hardcoded green) | Live connection test with real per-check results | Phase 2 | The banner in `AIToolsConfig` lines 161-169 is a mockup and must be removed or replaced by the real test UI |

**Deprecated/outdated:**
- Hardcoded detection banner in `ai-tools-config.tsx` (lines 161-169): This static green banner claiming "检测到最近使用 / 找到此代理的最近身份验证凭据" is a placeholder. Per CONTEXT.md "Specific Ideas": Phase 2 replaces this concept with actual live connection testing. The banner should be removed from `AIToolsConfig` as part of this phase.

---

## Open Questions

1. **Version check placement: before or after hello probe?**
   - What we know: D-05 says display version in adapter section header OR as an additional check row. Check 1 verifies command exists; version check requires command to exist.
   - What's unclear: Whether version check should be check position 2 (before API key and hello probe) or check position 4 (after hello probe).
   - Recommendation: Insert as check 2, immediately after command resolution succeeds. Version is lightweight (< 5s timeout) and provides useful context regardless of whether hello probe passes.

2. **Should the version string appear in the card header or as a check row?**
   - What we know: D-05 says "Display version in the adapter section header or as an additional check row when available."
   - What's unclear: Which placement is cleaner given the existing card layout.
   - Recommendation: Render as a check row named `claude_version` — consistent with other checks, requires no extra prop threading to the header.

3. **Should the static detection banner in AIToolsConfig be removed or kept?**
   - What we know: CONTEXT.md "Specific Ideas" says Phase 2 replaces this concept with actual live testing.
   - What's unclear: Whether the banner should be outright deleted or replaced inline.
   - Recommendation: Remove the banner (lines 161-169 in `ai-tools-config.tsx`) and add a `<CLIAdapterTester>` section in its place or as a sibling below the save button.

---

## Environment Availability

Step 2.6: SKIPPED — no external dependencies beyond the project's own code. All runtime dependencies (Node.js, `child_process`, the `claude` CLI) are already accounted for by the existing adapter infrastructure. The `claude` CLI availability is exactly what this phase tests — the UI gracefully handles both present and absent CLI.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 + Testing Library React 16.3.2 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLIV-01 | Test Connection button triggers POST /api/adapters/test | unit (component) | `pnpm test:run tests/unit/components/cli-adapter-tester.test.tsx` | Wave 0 |
| CLIV-02 | Per-check rows render with correct pass/fail icon and message | unit (component) | `pnpm test:run tests/unit/components/cli-adapter-tester.test.tsx` | Wave 0 |
| CLIV-03 | Version check row appears in results | unit (component) + unit (adapter) | `pnpm test:run tests/unit/components/cli-adapter-tester.test.tsx` | Wave 0 |
| CLIV-04 | Button is disabled while testing=true | unit (component) | `pnpm test:run tests/unit/components/cli-adapter-tester.test.tsx` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:run tests/unit/components/cli-adapter-tester.test.tsx`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/components/cli-adapter-tester.test.tsx` — covers CLIV-01, CLIV-02, CLIV-03, CLIV-04
- [ ] Mock for `fetch` to `/api/adapters/test` — needed to avoid real network calls in unit tests

*(Existing test infrastructure covers the framework — `vitest.config.ts`, `tests/setup.ts`, and `@testing-library/react` are all installed. Only the test file itself is missing.)*

---

## Project Constraints (from CLAUDE.md)

The following directives from `AGENTS.md` (referenced by `CLAUDE.md`) apply to this phase:

1. **Read Next.js 16 docs first:** AGENTS.md states "This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code." Confirmed: Next.js 16.2.1 is installed. Server actions are stable (no experimental flag needed). `maxDuration` is supported for route segments and server actions.
2. **No `console.log` in production code:** TypeScript hooks rule — use proper logging or omit entirely.
3. **Immutability:** Always return new objects; never mutate existing state (e.g., use `setResult(newResult)` not mutation of result object).
4. **Input validation:** API route already validates with Zod — maintain this on any new server-side entry points.
5. **i18n mandatory:** All user-facing strings through `useI18n()` hook — no raw string literals in JSX.
6. **Small files, high cohesion:** New component `cli-adapter-tester.tsx` should stay focused — test UI only, not mixed with config editor logic.
7. **Peer review checkpoints:** Plan review before coding, code review before marking done (CLAUDE.md peer review framework).

---

## Sources

### Primary (HIGH confidence)
- `src/app/api/adapters/test/route.ts` — Full API route implementation verified by reading source
- `src/lib/adapters/types.ts` — `TestResult`, `TestCheck`, `AdapterModule` interfaces verified
- `src/lib/adapters/registry.ts` — `listAdapters()`, `getAdapter()` verified
- `src/lib/adapters/claude-local/test.ts` — Full `testEnvironment()` implementation verified (3 checks)
- `src/lib/adapters/process-utils.ts` — `runChildProcess()`, `ensureCommandResolvable()` verified
- `src/components/settings/ai-tools-config.tsx` — Existing UI patterns verified
- `src/lib/i18n.tsx` — Translation system, `useI18n()` hook, full key set verified
- `src/app/settings/page.tsx` — Settings page structure and active section routing verified
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md` — `maxDuration` behavior for server actions confirmed

### Secondary (MEDIUM confidence)
- `vitest.config.ts` + `tests/setup.ts` + `tests/unit/components/board-stats.test.tsx` — Test infrastructure and patterns verified by reading source

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in `package.json`, all APIs verified in source
- Architecture: HIGH — existing API route, component patterns, and type system all verified
- Pitfalls: HIGH — timeout behavior verified in Next.js docs; i18n pitfall verified by reading `i18n.tsx` type system

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable stack, no fast-moving dependencies)
