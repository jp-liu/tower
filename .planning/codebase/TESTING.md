# Testing Patterns

**Analysis Date:** 2026-03-26

## Test Framework

**Unit/Integration Runner:**
- Vitest 4.1.1
- Config: `vitest.config.ts`
- Environment: jsdom
- React support: `@vitejs/plugin-react`

**E2E Runner:**
- Playwright 1.58.2
- Config: `playwright.config.ts`
- Browser: Chromium only
- Base URL: `http://localhost:3000`

**Assertion Libraries:**
- Vitest built-in `expect`
- `@testing-library/jest-dom/vitest` for DOM matchers (`.toBeInTheDocument()`)
- Playwright built-in `expect` for E2E

**Run Commands:**
```bash
pnpm test                # Run vitest in watch mode
pnpm test:run            # Run vitest once (CI-friendly)
npx playwright test      # Run E2E tests (requires dev server running)
```

## Test File Organization

**Location:**
- Unit/integration tests: `tests/unit/` directory (separate from source)
- E2E tests: `tests/e2e/` directory
- Test setup: `tests/setup.ts`

**Naming:**
- Unit tests: `*.test.ts` or `*.test.tsx`
- E2E tests: `*.spec.ts`

**Structure:**
```
tests/
├── setup.ts                              # Vitest setup (imports jest-dom matchers)
├── unit/
│   ├── components/
│   │   └── board-stats.test.tsx           # Component test
│   └── lib/
│       └── utils.test.ts                 # Utility test
└── e2e/
    └── smoke.spec.ts                     # E2E smoke tests
```

**Vitest config includes pattern:** `tests/**/*.test.{ts,tsx}`

## Test Setup

**`tests/setup.ts`:**
```typescript
import "@testing-library/jest-dom/vitest";
```

**Path alias:** `@` resolves to `./src` via Vitest `resolve.alias` config, matching the main `tsconfig.json`.

## Test Structure

**Unit Test Pattern:**
```typescript
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ComponentName } from "@/components/path/component-name";

afterEach(() => {
  cleanup();
});

describe("ComponentName", () => {
  it("describes expected behavior", () => {
    render(<ComponentName prop={value} />);
    expect(screen.getByText("expected text")).toBeInTheDocument();
  });
});
```

**Utility Test Pattern:**
```typescript
import { describe, it, expect } from "vitest";
import { utilFunction } from "@/lib/utils";

describe("utilFunction", () => {
  it("describes expected behavior", () => {
    expect(utilFunction(input)).toBe(expected);
  });
});
```

**E2E Test Pattern:**
```typescript
import { test, expect } from "@playwright/test";

test.describe.serial("Feature Name", () => {
  test("step description", async ({ page }) => {
    await page.goto("/path");
    await expect(page.locator("selector")).toBeVisible();
  });
});
```

**E2E Characteristics:**
- Uses `test.describe.serial` for ordered test execution (tests depend on prior state)
- Chinese UI text used in selectors (app defaults to `zh` locale)
- Locators use `data-testid` attributes where available (`task-card`, `task-detail-panel`)
- Fallback-heavy: tests use loops to find buttons by text content rather than stable selectors
- Uses `page.waitForTimeout()` for timing (brittle pattern)

## Mocking

**Framework:** No mocking observed in current tests

**What is tested without mocks:**
- Pure utility functions (`cn`, `formatRelativeTime`)
- Presentational components with static props (`BoardStats`)

**What SHOULD be mocked but is not tested:**
- Server actions (Prisma calls)
- API routes
- Zustand stores
- `useRouter`, `useI18n`, and other hooks

## Fixtures and Factories

**Test Data:**
- Inline test data passed directly as props in test files
- No shared fixtures, factories, or test helpers
- Example from `tests/unit/components/board-stats.test.tsx`:
```typescript
render(<BoardStats totalTasks={5} runningTasks={3} />);
```

**Location:**
- No dedicated fixture directory exists

## Coverage

**Requirements:** None enforced — no coverage thresholds configured in `vitest.config.ts`

**View Coverage:**
```bash
pnpm test:run -- --coverage    # Requires @vitest/coverage-v8 or similar (not installed)
```

**Current State:** No coverage provider is installed. Coverage reporting is not configured.

## Test Types

**Unit Tests (2 files):**
- `tests/unit/lib/utils.test.ts` — Tests `cn()` class merging and `formatRelativeTime()` utility
- `tests/unit/components/board-stats.test.tsx` — Tests `BoardStats` component rendering

**Integration Tests:**
- None present. Server actions, API routes, and database operations have zero test coverage.

**E2E Tests (1 file):**
- `tests/e2e/smoke.spec.ts` — 12 serial tests covering core user flows:
  1. Home page loads
  2. Create workspace
  3. Navigate to workspace
  4. Create project
  5. Create task
  6. Open task detail panel
  7. Send message in task panel
  8. Edit task title
  9. Search tasks (Cmd+K)
  10. Filter tasks
  11. Open settings page
  12. Delete task

## Common Patterns

**Async Testing:**
- Not yet established in unit tests (no async tests exist)
- E2E uses standard Playwright async patterns:
```typescript
test("name", async ({ page }) => {
  await page.goto("/path");
  await expect(page.locator("selector")).toBeVisible({ timeout: 3000 });
});
```

**Error Testing:**
- Not present in any test files

**Component Testing with i18n:**
- `BoardStats` test relies on `I18nProvider` wrapping but does NOT explicitly wrap with it
- This works because `useI18n` is called inside the component; the test passes because the component renders Chinese text by default (the `I18nProvider` context falls through)
- **Caution:** Components using `useI18n()` will throw `"useI18n must be used within I18nProvider"` unless wrapped or the hook is mocked

## Test Gaps (Critical)

**Untested areas by priority:**

**HIGH - Server Actions (`src/actions/`):**
- `task-actions.ts` — 0% coverage (CRUD operations, search, archive)
- `workspace-actions.ts` — 0% coverage (workspace and project CRUD)
- `label-actions.ts` — 0% coverage
- `agent-actions.ts` — 0% coverage (message sending, execution management)
- `agent-config-actions.ts` — 0% coverage
- Risk: Database mutations have no automated verification

**HIGH - API Routes (`src/app/api/`):**
- `tasks/[taskId]/execute/route.ts` — 0% coverage (execution lifecycle)
- `tasks/[taskId]/stream/route.ts` — 0% coverage (SSE streaming)
- `browse-fs/route.ts` — 0% coverage (filesystem access)
- `git/route.ts` — 0% coverage
- `adapters/test/route.ts` — 0% coverage
- Risk: API validation, error responses, and edge cases unverified

**HIGH - MCP Server (`src/mcp/`):**
- `server.ts`, `db.ts`, all tool files — 0% coverage
- Risk: External AI agent integrations have no test coverage

**MEDIUM - Zustand Stores:**
- `board-store.ts` — 0% coverage (filtering logic, task archival date logic)
- `task-execution-store.ts` — 0% coverage
- Risk: State management logic for archive date filtering is complex and untested

**MEDIUM - Components:**
- Most components untested: `KanbanBoard`, `TaskCard`, `CreateTaskDialog`, `TaskDetailPanel`, `AppSidebar`, `SearchDialog`
- Risk: UI regressions undetected

**LOW - Utilities:**
- `git-url.ts` — 0% coverage
- `src/lib/adapters/` — 0% coverage (adapter system including Claude Code integration)

**Overall estimated coverage:** < 5% of application code

---

*Testing analysis: 2026-03-26*
