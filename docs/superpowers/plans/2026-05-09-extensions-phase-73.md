# Extensions System — Phase 73: Onboarding Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboarding wizard adds a new "Extensions" step between CLI test (current step 2) and the final "complete" action. Both extensions default-checked. Unchecking shows hint about Settings → Extensions. Submit installs in parallel; failures persisted to SystemConfig for later notification.

**Architecture:** Insert a new step 4 ("Enable extensions") into the actual onboarding entry point — `src/app/onboarding/page.tsx` (NOT the dead `OnboardingWizard` dialog component). Existing 3 steps stay in order: Username → CLI test → Git path rules → **Extensions (new)** → complete. New `setOnboardingExtensions` server action persists `onboarding.extensions.requested` / `onboarding.extensions.completed` to `SystemConfig`. The Git rules step's "complete" action becomes "next"; the new Extensions step owns the final `completeOnboarding(username)` call.

**Tech Stack:** Next.js 16 App Router, React 19, Vitest + RTL, shadcn Button/Checkbox.

---

## Files Created / Modified

**Created**
- `src/app/onboarding/wizard-step-extensions.tsx` — new step component (collocated with the page)
- `src/app/onboarding/__tests__/wizard-step-extensions.test.tsx` — RTL smoke test

**Modified**
- `src/app/onboarding/page.tsx` — `TOTAL_STEPS` 3→4, add step 4 to `stepIcons`, add `step === 4` rendering, change step 3's "complete" button to "next" (advances to step 4); the new step 4 calls `handleComplete`
- `src/actions/onboarding-actions.ts` — add `setOnboardingExtensions(requested, completed)` server action; update `completeOnboarding` to accept optional `lastStep` param (default 4) so resume logic works correctly post-Phase 73
- `src/actions/__tests__/onboarding-actions.test.ts` — add tests for new action + parametrized completeOnboarding
- `src/lib/i18n/zh.ts` and `src/lib/i18n/en.ts` — add `onboarding.step4.*` keys (step3 namespace is already taken by Git rules)

**Untouched (deliberately)**
- `src/components/onboarding/onboarding-wizard.tsx` — DEAD CODE (not imported anywhere outside its own dir). Don't waste effort modifying it.
- `src/components/onboarding/wizard-step-cli.tsx` — only consumed by the dead OnboardingWizard. Leave alone.
- `src/components/onboarding/__tests__/onboarding-wizard.test.tsx` — tests dead component; will continue to pass without changes.
- `src/lib/extensions/*` — Phases 71/72 already provide the install action
- `src/components/settings/extensions-section.tsx` — already exists for the "future setup" path

---

## Test Strategy

- **Unit test** for `setOnboardingExtensions` action (verify SystemConfig keys written)
- **RTL smoke test** for `WizardStepExtensions`:
  - Renders one row per registered extension (uses real `listExtensions()`)
  - Default state: all checkboxes checked
  - Unchecking one shows the "可在 设置 → Extensions" hint
  - Clicking "下一步" with all checked calls `installExtension` for each id in parallel + advances + persists
  - Clicking "下一步" with none checked calls no installs, just persists empty list + advances
- **No deep onboarding flow E2E** — handled by existing `tests/e2e/settings-flow.spec.ts` style tests outside this phase

---

## Task 1: Server action — setOnboardingExtensions + parametrize completeOnboarding

**Files:**
- Modify: `src/actions/onboarding-actions.ts`
- Modify: `src/actions/__tests__/onboarding-actions.test.ts`

Two additions:
1. **`setOnboardingExtensions(requested, completed)`** — persists user's extension selection. Two SystemConfig keys, JSON-serialized arrays:
   - `onboarding.extensions.requested` — ids the user opted into
   - `onboarding.extensions.completed` — ids that successfully installed (may diverge if installs fail)

2. **`completeOnboarding(username?, lastStep?)`** — currently hardcodes `lastStep = "2"`. Change to accept an optional `lastStep` parameter (default 4 so post-Phase-73 calls reflect the new total). Existing callers pass undefined and get the new default.

### Step 1: Inspect the existing test file's mock pattern

```bash
sed -n '1,40p' src/actions/__tests__/onboarding-actions.test.ts
```

Note how `db` is mocked. The existing pattern likely uses a typed `mockDb` alias and `mockDb.systemConfig.upsert.mockResolvedValue({})` in setup. Use the same pattern in new tests.

### Step 2: Write failing tests

Add a new describe block to `src/actions/__tests__/onboarding-actions.test.ts`:

```typescript
describe("setOnboardingExtensions", () => {
  beforeEach(() => {
    // Match the file's existing reset pattern (likely vi.clearAllMocks)
    vi.clearAllMocks();
  });

  it("persists requested + completed to SystemConfig as JSON arrays", async () => {
    const { setOnboardingExtensions } = await import("../onboarding-actions");

    await setOnboardingExtensions(["rg", "monaco"], ["rg"]);

    expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onboarding.extensions.requested" },
        create: { key: "onboarding.extensions.requested", value: JSON.stringify(["rg", "monaco"]) },
        update: { value: JSON.stringify(["rg", "monaco"]) },
      })
    );
    expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onboarding.extensions.completed" },
        create: { key: "onboarding.extensions.completed", value: JSON.stringify(["rg"]) },
        update: { value: JSON.stringify(["rg"]) },
      })
    );
  });

  it("handles empty arrays — user opted out of all extensions", async () => {
    const { setOnboardingExtensions } = await import("../onboarding-actions");

    await setOnboardingExtensions([], []);

    expect(mockDb.systemConfig.upsert).toHaveBeenCalledTimes(2);
  });
});

describe("completeOnboarding (parametrized lastStep)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("default lastStep is 4 (post-Phase-73)", async () => {
    const { completeOnboarding } = await import("../onboarding-actions");
    await completeOnboarding("alice");
    expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onboarding.lastStep" },
        update: { value: "4" },
      })
    );
  });

  it("explicit lastStep overrides default", async () => {
    const { completeOnboarding } = await import("../onboarding-actions");
    await completeOnboarding("alice", 7);
    expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onboarding.lastStep" },
        update: { value: "7" },
      })
    );
  });
});
```

If `mockDb` is named differently in the file, adjust accordingly. The point: don't fight the existing test infrastructure.

### Step 2: Run — fail (action doesn't exist)

```bash
pnpm test:run src/actions/__tests__/onboarding-actions.test.ts
# Expected: FAIL — Cannot find name setOnboardingExtensions
```

### Step 3: Implement changes

Two edits to `src/actions/onboarding-actions.ts`:

**A. Append new action:**

```typescript
export async function setOnboardingExtensions(
  requested: string[],
  completed: string[]
): Promise<void> {
  await db.systemConfig.upsert({
    where: { key: "onboarding.extensions.requested" },
    create: { key: "onboarding.extensions.requested", value: JSON.stringify(requested) },
    update: { value: JSON.stringify(requested) },
  });
  await db.systemConfig.upsert({
    where: { key: "onboarding.extensions.completed" },
    create: { key: "onboarding.extensions.completed", value: JSON.stringify(completed) },
    update: { value: JSON.stringify(completed) },
  });
  revalidatePath("/", "layout");
}
```

**B. Parameterize `completeOnboarding`:**

Replace the existing signature:

```typescript
export async function completeOnboarding(username?: string): Promise<void> {
  // ... hardcoded "2"
  await db.systemConfig.upsert({
    where: { key: "onboarding.lastStep" },
    create: { key: "onboarding.lastStep", value: "2" },
    update: { value: "2" },
  });
  // ...
}
```

With:

```typescript
export async function completeOnboarding(
  username?: string,
  lastStep: number = 4
): Promise<void> {
  await db.systemConfig.upsert({
    where: { key: "onboarding.completed" },
    create: { key: "onboarding.completed", value: "true" },
    update: { value: "true" },
  });
  await db.systemConfig.upsert({
    where: { key: "onboarding.lastStep" },
    create: { key: "onboarding.lastStep", value: String(lastStep) },
    update: { value: String(lastStep) },
  });
  // ... rest of username handling unchanged
}
```

The default `4` is correct for the post-Phase-73 wizard. Existing callers (`src/app/onboarding/page.tsx:251`) don't pass step → get default 4 → which matches reality (they finish step 4 = extensions step). Step 5 of this Task updates that call site if needed.

### Step 4: Run — should pass

```bash
pnpm test:run src/actions/__tests__/onboarding-actions.test.ts
# Expected: all pass (existing + 2 new)
```

### Step 5: Commit

```bash
git add src/actions/onboarding-actions.ts src/actions/__tests__/onboarding-actions.test.ts
git commit -m "feat(ext-73): setOnboardingExtensions action — persist requested + completed lists"
```

---

## Task 2: i18n keys for step 4

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

⚠️ The `onboarding.step3.*` namespace is **already in use** for the existing Git path rules step. Use `onboarding.step4.*` for the new Extensions step.

Also need to add a "下一步" / "Next" button for the step 3 (Git rules) → step 4 (Extensions) transition. The existing `onboarding.step1.next` key is `"下一步"`; we can reuse it (it's generic enough) OR introduce a new `onboarding.step3.next` if you prefer namespacing. Reusing is simpler — the plan does that.

### Keys (zh.ts)

```typescript
"onboarding.step4.title": "启用扩展（可选）",
"onboarding.step4.desc": "下面这些扩展能解锁文件查看和代码搜索。装一次，所有项目共享。",
"onboarding.step4.skipHint": "未启用的扩展可在 设置 → Extensions 中随时启用。",
"onboarding.step4.installing": "安装中...",
"onboarding.step4.continue": "完成",
"onboarding.step4.continueWithoutInstall": "跳过并完成",
"onboarding.step4.installFailedSummary": "{count} 个扩展安装失败，可在设置中重试",
```

### Keys (en.ts)

```typescript
"onboarding.step4.title": "Enable extensions (optional)",
"onboarding.step4.desc": "These extensions unlock file viewing and code search. Install once, shared across all projects.",
"onboarding.step4.skipHint": "Skipped extensions can be enabled later in Settings → Extensions.",
"onboarding.step4.installing": "Installing...",
"onboarding.step4.continue": "Finish",
"onboarding.step4.continueWithoutInstall": "Skip and finish",
"onboarding.step4.installFailedSummary": "{count} extension(s) failed to install — retry in Settings",
```

### Step 1: Find insertion point

```bash
grep -n "onboarding\\.step3\\.pathHint" src/lib/i18n/zh.ts | head -3
```

Add the 7 step4 keys right after the step3 cluster ends.

### Step 2: TS check — both files must have matching keys

```bash
pnpm tsc --noEmit 2>&1 | grep "i18n" | head -3
# Expected: clean
```

### Step 3: Commit

```bash
git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "i18n(ext-73): add onboarding.step4.* keys for Extensions wizard step"
```

---

## Task 3: WizardStepExtensions component

**Files:**
- Create: `src/app/onboarding/wizard-step-extensions.tsx`

```tsx
"use client";

import { useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { listExtensions } from "@/lib/extensions/registry";
import { installExtension } from "@/actions/extension-actions";
import {
  completeOnboarding,
  setOnboardingExtensions,
} from "@/actions/onboarding-actions";
import type { ExtensionId } from "@/lib/extensions/types";

interface WizardStepExtensionsProps {
  username: string;
  onComplete: () => void;
}

export function WizardStepExtensions({ username, onComplete }: WizardStepExtensionsProps) {
  const { t } = useI18n();
  const extensions = listExtensions();

  // Default: all extensions checked. State is the set of currently-checked ids.
  const [selected, setSelected] = useState<Set<ExtensionId>>(
    () => new Set(extensions.map((e) => e.id))
  );
  const [installing, setInstalling] = useState(false);

  const allCount = extensions.length;
  const selectedCount = selected.size;
  const someUnchecked = selectedCount < allCount;

  const toggle = (id: ExtensionId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  async function handleFinish() {
    setInstalling(true);
    const requested = Array.from(selected);
    const completed: string[] = [];

    if (requested.length > 0) {
      // Install in parallel; collect successes
      const results = await Promise.all(
        requested.map(async (id) => {
          try {
            const result = await installExtension(id);
            return { id, success: result.success };
          } catch {
            return { id, success: false };
          }
        })
      );
      for (const r of results) {
        if (r.success) completed.push(r.id);
      }
    }

    // Persist selections + actual results
    await setOnboardingExtensions(requested, completed);
    // Mark onboarding done with username
    await completeOnboarding(username);
    setInstalling(false);
    onComplete();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t("onboarding.step4.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step4.desc")}</p>
      </div>

      <div className="space-y-2">
        {extensions.map((ext) => {
          const Icon = ext.icon;
          const checked = selected.has(ext.id);
          return (
            <label
              key={ext.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(ext.id)}
                disabled={installing}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
              />
              <div className="flex flex-1 items-start gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{ext.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">~{ext.sizeMB} MB</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{ext.description}</p>
                  <a
                    href={ext.homepageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("settings.extensions.visitHomepage")}
                  </a>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {someUnchecked && (
        <p className="text-xs text-muted-foreground italic">
          {t("onboarding.step4.skipHint")}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleFinish} disabled={installing}>
          {installing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("onboarding.step4.installing")}
            </>
          ) : selectedCount === 0 ? (
            t("onboarding.step4.continueWithoutInstall")
          ) : (
            t("onboarding.step4.continue")
          )}
        </Button>
      </div>
    </div>
  );
}
```

### Step 1: Create file (verbatim from above)

### Step 2: TS check

```bash
pnpm tsc --noEmit 2>&1 | grep "wizard-step-extensions" | head -3
# Expected: clean
```

### Step 3: Commit

```bash
git add src/app/onboarding/wizard-step-extensions.tsx
git commit -m "feat(ext-73): WizardStepExtensions — onboarding wizard step 4"
```

---

## Task 4: WizardStepExtensions smoke test

**Files:**
- Create: `src/app/onboarding/__tests__/wizard-step-extensions.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { WizardStepExtensions } from "../wizard-step-extensions";

vi.mock("@/actions/extension-actions", () => ({
  installExtension: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/actions/onboarding-actions", () => ({
  setOnboardingExtensions: vi.fn().mockResolvedValue(undefined),
  completeOnboarding: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderStep(onComplete = vi.fn()) {
  return render(
    <I18nProvider>
      <WizardStepExtensions username="tester" onComplete={onComplete} />
    </I18nProvider>
  );
}

describe("WizardStepExtensions", () => {
  it("renders one row per registered extension", async () => {
    renderStep();
    await waitFor(() => {
      // Both real extension descriptions appear
      const rgNodes = screen.queryAllByText(/代码搜索|ripgrep/i);
      const monacoNodes = screen.queryAllByText(/代码编辑器|Monaco/i);
      expect(rgNodes.length).toBeGreaterThanOrEqual(1);
      expect(monacoNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("starts with all checkboxes checked by default", () => {
    renderStep();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(2);
    for (const cb of checkboxes) {
      expect(cb).toBeChecked();
    }
  });

  it("unchecking shows the skip hint", async () => {
    const user = userEvent.setup();
    renderStep();
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    expect(screen.getByText(/设置 → Extensions|Settings → Extensions/i)).toBeInTheDocument();
  });

  it("clicking 完成 with all checked installs all in parallel and completes", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const actions = await import("@/actions/extension-actions");
    const onboarding = await import("@/actions/onboarding-actions");

    renderStep(onComplete);
    const finishBtn = screen.getByRole("button", { name: /完成|Finish/i });
    await user.click(finishBtn);

    await waitFor(() => {
      expect(actions.installExtension).toHaveBeenCalledTimes(2);
      expect(onboarding.setOnboardingExtensions).toHaveBeenCalledWith(
        expect.arrayContaining(["rg", "monaco"]),
        expect.arrayContaining(["rg", "monaco"])
      );
      expect(onboarding.completeOnboarding).toHaveBeenCalledWith("tester");
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("clicking 跳过并完成 with none checked installs nothing and completes", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const actions = await import("@/actions/extension-actions");
    const onboarding = await import("@/actions/onboarding-actions");

    renderStep(onComplete);
    // Uncheck all
    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      await user.click(cb);
    }
    const finishBtn = screen.getByRole("button", { name: /跳过|Skip/i });
    await user.click(finishBtn);

    await waitFor(() => {
      expect(actions.installExtension).not.toHaveBeenCalled();
      expect(onboarding.setOnboardingExtensions).toHaveBeenCalledWith([], []);
      expect(onboarding.completeOnboarding).toHaveBeenCalledWith("tester");
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
```

### Step 1: Run — should pass after fixing imports / mocks

```bash
pnpm test:run src/app/onboarding/__tests__/wizard-step-extensions.test.tsx
# Expected: 5 passed
```

### Step 2: Verify no regressions

```bash
pnpm test:run src/lib/extensions/ src/actions/__tests__/extension-actions.test.ts src/actions/__tests__/onboarding-actions.test.ts src/components/settings/__tests__/extensions-section.test.tsx src/app/onboarding/__tests__/wizard-step-extensions.test.tsx
# Expected: all green
```

### Step 3: Commit

```bash
git add src/app/onboarding/__tests__/wizard-step-extensions.test.tsx
git commit -m "test(ext-73): smoke test for WizardStepExtensions"
```

---

## Task 5: Wire step 4 into the real onboarding page

**File:**
- Modify: `src/app/onboarding/page.tsx` — the actual onboarding entry (NOT `onboarding-wizard.tsx`, which is dead code)

### Changes

1. Add `import { Package } from "lucide-react";` (for stepIcons array)
2. Add `import { WizardStepExtensions } from "./wizard-step-extensions";`
3. Change `const TOTAL_STEPS = 3;` → `const TOTAL_STEPS = 4;`
4. Add a 4th entry to `stepIcons` array (around line 260):
   ```tsx
   { icon: Package, label: t("onboarding.step4.title") },
   ```
5. Locate step 3's submit/finish button (around line 540+ — the Git rules step's "complete" button currently calls `handleComplete`). Change it to `setStep((s) => s + 1)` instead, and update its label from `onboarding.complete` (or whatever current key) to `onboarding.step1.next` (reusing the generic 下一步 / Next).
6. Add step 4 rendering after step 3's closing block:
   ```tsx
   {step === 4 && (
     <WizardStepExtensions
       username={username}
       gitRules={gitRules}
       onComplete={handleComplete}
     />
   )}
   ```

   Note: `handleComplete` already saves git rules + calls `completeOnboarding`. The WizardStepExtensions component invokes it as the final step.

7. WizardStepExtensions needs the `gitRules` prop because step 3's submit no longer calls `handleComplete` — instead, step 4 takes responsibility for the final save. Update the component signature in Task 3 to accept `gitRules` and pass them through to `handleComplete`.

   **OR** (simpler): step 3 still saves git rules to SystemConfig on its "next" click (separate save), and step 4 only handles extension install + completeOnboarding. Pick the simpler split:
   - **Step 3 next click**: `await setConfigValue("git.pathMappingRules", gitRules); setStep(s => s + 1);`
   - **Step 4 finish click**: install extensions, persist requested/completed, call `completeOnboarding(username)`, then `router.replace("/workspaces")`.

   This way step 4 doesn't need `gitRules` prop. **Use this simpler split.**

### Component signature (for Task 3)

Task 3 already specifies `onComplete: () => void` — keep as-is. Caller in page.tsx:

```tsx
{step === 4 && (
  <WizardStepExtensions
    username={username}
    onComplete={() => router.replace("/workspaces")}
  />
)}
```

The component's internal flow:
1. Install selected extensions in parallel
2. `setOnboardingExtensions(requested, completed)`
3. `completeOnboarding(username)` (uses default `lastStep: 4`)
4. Call `onComplete()` — which triggers the router redirect

### Step 1: Edit page.tsx

Read the file's relevant sections first:

```bash
sed -n '1,60p' src/app/onboarding/page.tsx          # imports
sed -n '180,230p' src/app/onboarding/page.tsx        # state + handlers
sed -n '244,270p' src/app/onboarding/page.tsx        # handleComplete + stepIcons
sed -n '430,560p' src/app/onboarding/page.tsx        # step 3 (Git rules) submit
```

Locate the step 3 finish button (the one that calls `handleComplete`). Change its onClick to advance to step 4 + save git rules:

```tsx
onClick={async () => {
  if (gitRules.length > 0) {
    await setConfigValue("git.pathMappingRules", gitRules);
  }
  setStep((s) => s + 1);
}}
```

The original `handleComplete` is now unused — step 4's `WizardStepExtensions` calls `completeOnboarding` directly. **Delete the orphan `handleComplete` function** (and any unused state like `completing` if it's exclusive to it) so we don't leave dead code behind.

### Step 2: TS check

```bash
pnpm tsc --noEmit 2>&1 | grep "onboarding/page" | head -10
# Expected: clean
```

### Step 3: Run all extension + onboarding tests (no regressions)

```bash
pnpm test:run \
  src/lib/extensions/ \
  src/actions/__tests__/extension-actions.test.ts \
  src/actions/__tests__/onboarding-actions.test.ts \
  src/components/settings/__tests__/extensions-section.test.tsx \
  src/app/onboarding/__tests__/ \
  src/components/onboarding/__tests__/
# Expected: all green. The legacy onboarding-wizard.test.tsx still passes
# because we didn't touch that dead component.
```

### Step 4: Commit

```bash
git add src/app/onboarding/page.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "feat(ext-73): insert Extensions as step 4 in onboarding wizard"
```

---

## Task 6: Phase 73 verification + manual smoke

### Step 1: Full extension test sweep

```bash
pnpm test:run src/lib/extensions/ src/actions/__tests__/extension-actions.test.ts src/actions/__tests__/onboarding-actions.test.ts src/components/settings/__tests__/extensions-section.test.tsx src/components/onboarding/__tests__/
# Expected: all green
```

### Step 2: TS check

```bash
pnpm tsc --noEmit 2>&1 | grep -E "extensions|onboarding" | head -10
# Expected: clean (in our files)
```

### Step 3: Manual smoke (user verifies)

Reset onboarding state to test wizard from scratch:

```bash
sqlite3 prisma/dev.db "DELETE FROM SystemConfig WHERE key LIKE 'onboarding.%';"
```

Then:

| Step | Expected |
|------|----------|
| `pnpm dev`, navigate to root | Wizard opens at step 1 (username) |
| Enter username, click Next | Advance to step 2 (CLI test) |
| CLI test passes, click 下一步 | Advance to step 3 (Git path rules) |
| Git rules step, click 下一步 | Advance to step 4 (Extensions) |
| Step 3 shows: title, description, 2 extension rows with checkboxes | ✓ |
| Both checkboxes default-checked | ✓ |
| Uncheck one → "可在 设置 → Extensions" hint appears | ✓ |
| Recheck → hint disappears | ✓ |
| Visit homepage links open in new tab | ✓ |
| Click 完成 with all checked → installing spinner → onboarding complete → wizard closes | ✓ |
| Reset DB, repeat: click 跳过并完成 with all unchecked → wizard closes immediately, no install runs | ✓ |
| Verify SystemConfig has `onboarding.extensions.requested` and `onboarding.extensions.completed` rows | ✓ |

### Step 4: Final phase commit

```bash
git commit --allow-empty -m "chore(ext-73): phase 73 complete — Onboarding Integration

ONBD-EXT-01..05 satisfied:
- Wizard step 3 'Enable extensions' renders one row per registered ext
- Both extensions default-checked
- Unchecking shows 'Settings → Extensions' hint
- Submit installs in parallel via Promise.all of installExtension(id)
- Persists onboarding.extensions.requested + completed to SystemConfig
- handleCliNext replaces completeOnboarding in step 2; step 3 owns final
  completeOnboarding(username) call

Tests: 5 new RTL smoke tests + 2 onboarding-actions tests
TypeScript: 0 errors in Phase 71/72/73 files

v1.2 milestone (Phases 71-73) is now functionally complete. Phase 74
Build & Distribution slimming remains deferred to a separate milestone."
```

---

## Spec Deltas (Phase 73)

- **ONBD-EXT-04 partial — `onboarding.extensions.failed` flag NOT implemented**: The spec text says "On any failure: continue to next wizard step but persist a SystemConfig flag `onboarding.extensions.failed = ['monaco']` so a deferred toast surfaces on first workspace load." This plan persists `requested` + `completed` instead, from which the failure list is derivable (`requested - completed`). The deferred toast is not built — failures are visible in Settings → Extensions immediately, which we judge sufficient. If a deferred toast is later required, a small Phase 73.x can add it.

## Out of Scope (Phase 73)

- **Per-extension progress** — current implementation shows a single global "安装中..." spinner. Per-extension granular progress is nice-to-have, not in scope.
- **Retry-failed-installs button in step 4** — if any install fails, the user can finish onboarding and use Settings → Extensions later. No in-wizard retry.
- **Build & Distribution** (npm pack slimming, optionalDeps) — separate v1.2.x or v1.3 milestone.
- **Touching `onboarding-wizard.tsx` / `wizard-step-cli.tsx`** — these are dead code (not on the live onboarding path). Modifying them adds risk without value.

---

## After Plan Complete

Once Phase 73 is approved + executed:
- Run milestone verification across Phases 71-73
- v1.2 audit + complete-milestone (using GSD lifecycle commands or manual archive)
