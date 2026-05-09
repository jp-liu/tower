# Extensions System — Phase 73: Onboarding Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboarding wizard adds a new "Extensions" step between CLI test (current step 2) and the final "complete" action. Both extensions default-checked. Unchecking shows hint about Settings → Extensions. Submit installs in parallel; failures persisted to SystemConfig for later notification.

**Architecture:** New `WizardStepExtensions` component slotted as step 3 in `OnboardingWizard`. New `setOnboardingExtensions` server action persists `onboarding.extensions.requested` / `onboarding.extensions.completed` to `SystemConfig`. The CLI step's `handleComplete` becomes `handleNext` (advances to step 3); the Extensions step's submit calls `completeOnboarding`.

**Tech Stack:** Next.js 16 App Router, React 19, Vitest + RTL, shadcn Button/Checkbox.

---

## Files Created / Modified

**Created**
- `src/components/onboarding/wizard-step-extensions.tsx` — new wizard step
- `src/components/onboarding/__tests__/wizard-step-extensions.test.tsx` — RTL smoke test

**Modified**
- `src/components/onboarding/onboarding-wizard.tsx` — `TOTAL_STEPS` to 3, add step 3 rendering
- `src/components/onboarding/wizard-step-cli.tsx` — rename `handleComplete` to `handleNext`, advance to step 3 instead of completing; remove `completeOnboarding` call (step 3 owns it now)
- `src/actions/onboarding-actions.ts` — add `setOnboardingExtensions(requested, completed)` server action
- `src/actions/__tests__/onboarding-actions.test.ts` — add tests for new action
- `src/lib/i18n/zh.ts` and `src/lib/i18n/en.ts` — add `onboarding.step3.*` keys

**Untouched**
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

## Task 1: Server action — setOnboardingExtensions

**Files:**
- Modify: `src/actions/onboarding-actions.ts`
- Modify: `src/actions/__tests__/onboarding-actions.test.ts`

The action persists user's extension selection in `SystemConfig`. Two keys:
- `onboarding.extensions.requested` — JSON-serialized array of extension ids the user opted into
- `onboarding.extensions.completed` — JSON-serialized array of ids that successfully installed

Both stored independently — they may diverge if some installs fail.

### Step 1: Write failing test

In `src/actions/__tests__/onboarding-actions.test.ts`, add a new describe block:

```typescript
describe("setOnboardingExtensions", () => {
  it("persists requested + completed to SystemConfig as JSON arrays", async () => {
    const { setOnboardingExtensions } = await import("../onboarding-actions");
    const { db } = await import("@/lib/db");

    await setOnboardingExtensions(["rg", "monaco"], ["rg"]);

    expect(db.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onboarding.extensions.requested" },
        create: { key: "onboarding.extensions.requested", value: JSON.stringify(["rg", "monaco"]) },
        update: { value: JSON.stringify(["rg", "monaco"]) },
      })
    );
    expect(db.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onboarding.extensions.completed" },
        create: { key: "onboarding.extensions.completed", value: JSON.stringify(["rg"]) },
        update: { value: JSON.stringify(["rg"]) },
      })
    );
  });

  it("handles empty arrays — user opted out of all extensions", async () => {
    const { setOnboardingExtensions } = await import("../onboarding-actions");
    const { db } = await import("@/lib/db");
    (db.systemConfig.upsert as unknown as ReturnType<typeof vi.fn>).mockClear();

    await setOnboardingExtensions([], []);

    // Should still write both keys with "[]"
    expect(db.systemConfig.upsert).toHaveBeenCalledTimes(2);
  });
});
```

(Adjust mocking to match the existing test file's setup — read it first to see how `db.systemConfig.upsert` is mocked.)

### Step 2: Run — fail (action doesn't exist)

```bash
pnpm test:run src/actions/__tests__/onboarding-actions.test.ts
# Expected: FAIL — Cannot find name setOnboardingExtensions
```

### Step 3: Implement action

Append to `src/actions/onboarding-actions.ts`:

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

## Task 2: i18n keys for step 3

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

### Keys (zh.ts — find the existing `onboarding.*` cluster)

```typescript
"onboarding.step3.title": "启用扩展（可选）",
"onboarding.step3.desc": "下面这些扩展能解锁文件查看和代码搜索。装一次，所有项目共享。",
"onboarding.step3.skipHint": "未启用的扩展可在 设置 → Extensions 中随时启用。",
"onboarding.step3.installing": "安装中...",
"onboarding.step3.continue": "完成",
"onboarding.step3.continueWithoutInstall": "跳过并完成",
"onboarding.step3.installFailedSummary": "{count} 个扩展安装失败，可在设置中重试",
```

### Keys (en.ts — same set)

```typescript
"onboarding.step3.title": "Enable extensions (optional)",
"onboarding.step3.desc": "These extensions unlock file viewing and code search. Install once, shared across all projects.",
"onboarding.step3.skipHint": "Skipped extensions can be enabled later in Settings → Extensions.",
"onboarding.step3.installing": "Installing...",
"onboarding.step3.continue": "Finish",
"onboarding.step3.continueWithoutInstall": "Skip and finish",
"onboarding.step3.installFailedSummary": "{count} extension(s) failed to install — retry in Settings",
```

### Step 1: Add keys (find the existing `onboarding.step2.*` cluster and add adjacent)

```bash
grep -n "onboarding\\.step2\\." src/lib/i18n/zh.ts
```

Then add the 7 step3 keys right after step2.

### Step 2: TS check — both files must have matching keys

```bash
pnpm tsc --noEmit 2>&1 | grep "i18n" | head -3
# Expected: clean
```

### Step 3: Commit

```bash
git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "i18n(ext-73): add onboarding.step3.* keys for Extensions wizard step"
```

---

## Task 3: WizardStepExtensions component

**Files:**
- Create: `src/components/onboarding/wizard-step-extensions.tsx`

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
        <h2 className="text-xl font-semibold">{t("onboarding.step3.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step3.desc")}</p>
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
          {t("onboarding.step3.skipHint")}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleFinish} disabled={installing}>
          {installing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("onboarding.step3.installing")}
            </>
          ) : selectedCount === 0 ? (
            t("onboarding.step3.continueWithoutInstall")
          ) : (
            t("onboarding.step3.continue")
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
git add src/components/onboarding/wizard-step-extensions.tsx
git commit -m "feat(ext-73): WizardStepExtensions — onboarding wizard step 3"
```

---

## Task 4: WizardStepExtensions smoke test

**Files:**
- Create: `src/components/onboarding/__tests__/wizard-step-extensions.test.tsx`

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
pnpm test:run src/components/onboarding/__tests__/wizard-step-extensions.test.tsx
# Expected: 5 passed
```

### Step 2: Verify no regressions

```bash
pnpm test:run src/lib/extensions/ src/actions/__tests__/extension-actions.test.ts src/actions/__tests__/onboarding-actions.test.ts src/components/settings/__tests__/extensions-section.test.tsx src/components/onboarding/__tests__/wizard-step-extensions.test.tsx
# Expected: all green
```

### Step 3: Commit

```bash
git add src/components/onboarding/__tests__/wizard-step-extensions.test.tsx
git commit -m "test(ext-73): smoke test for WizardStepExtensions"
```

---

## Task 5: Wire step 3 into OnboardingWizard + adjust step 2

**Files:**
- Modify: `src/components/onboarding/onboarding-wizard.tsx`
- Modify: `src/components/onboarding/wizard-step-cli.tsx`

### Changes to onboarding-wizard.tsx

1. Add `import { WizardStepExtensions } from "./wizard-step-extensions";`
2. Change `const TOTAL_STEPS = 2;` → `const TOTAL_STEPS = 3;`
3. Update step 2's `WizardStepCli` to call new `handleCliNext` instead of `onComplete`
4. Add step 3 rendering with `<WizardStepExtensions username={username} onComplete={onComplete} />`

```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { setOnboardingProgress } from "@/actions/onboarding-actions";
import { WizardStepUsername } from "./wizard-step-username";
import { WizardStepCli } from "./wizard-step-cli";
import { WizardStepExtensions } from "./wizard-step-extensions";

const TOTAL_STEPS = 3;

interface OnboardingWizardProps {
  onComplete: () => void;
  initialStep?: number;
  initialUsername?: string;
}

export function OnboardingWizard({ onComplete, initialStep, initialUsername }: OnboardingWizardProps) {
  const { t } = useI18n();
  const [step, setStep] = useState(initialStep ?? 1);
  const [username, setUsername] = useState(initialUsername ?? "");

  async function handleUsernameNext(name: string) {
    setUsername(name);
    await setOnboardingProgress(1);
    setStep(2);
  }

  async function handleCliNext() {
    await setOnboardingProgress(2);
    setStep(3);
  }

  const stepIndicator = t("onboarding.stepIndicator")
    .replace("{current}", String(step))
    .replace("{total}", String(TOTAL_STEPS));

  return (
    <Dialog open={true} onOpenChange={() => {}} disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        style={{
          width: "100vw",
          height: "100vh",
          maxWidth: "none",
          top: 0,
          left: 0,
          transform: "none",
          borderRadius: 0,
        }}
      >
        <div className="flex flex-col items-center justify-center h-full">
          <div className="w-full max-w-md px-4 space-y-8">
            <div className="text-center space-y-3">
              <h1 className="text-2xl font-bold">{t("onboarding.title")}</h1>

              <div className="flex items-center justify-center gap-2">
                {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                  <div
                    key={i}
                    className={`h-2 w-2 rounded-full transition-colors ${
                      i + 1 === step
                        ? "bg-primary"
                        : i + 1 < step
                        ? "bg-primary/50"
                        : "bg-muted"
                    }`}
                  />
                ))}
              </div>

              <p className="text-xs text-muted-foreground">{stepIndicator}</p>
            </div>

            {step === 1 && (
              <WizardStepUsername onNext={handleUsernameNext} />
            )}
            {step === 2 && (
              <WizardStepCli onNext={handleCliNext} />
            )}
            {step === 3 && (
              <WizardStepExtensions username={username} onComplete={onComplete} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Changes to wizard-step-cli.tsx

The CLI step previously called `completeOnboarding(username)` directly. Now it just signals "advance to step 3" — step 3 will call completeOnboarding.

Change the prop interface:

```tsx
interface WizardStepCliProps {
  onNext: () => void;
}

export function WizardStepCli({ onNext }: WizardStepCliProps) {
  // ... existing state
  // Remove handleComplete
  // Add:
  const [advancing, setAdvancing] = useState(false);
  async function handleNext() {
    setAdvancing(true);
    onNext();
  }
  // Render: button calls handleNext, label changes from "完成" to "下一步"
}
```

Also remove the `username` prop and `completeOnboarding` import — no longer needed here.

The button label should change from `t("onboarding.complete")` to `t("onboarding.next")` (use existing key if it exists, else add).

### Step 1: Verify if `onboarding.next` key already exists

```bash
grep -n "onboarding\\.next\\|onboarding\\.complete" src/lib/i18n/zh.ts | head -5
```

If `onboarding.next` exists, use it. Otherwise add it (same Task 2 pattern). Likely value: zh `"下一步"`, en `"Next"`.

### Step 2: Make all changes, run tests

```bash
pnpm test:run src/components/onboarding/__tests__/
# Existing onboarding-wizard.test.tsx may need updating since CLI step changed.
# Read the existing test file first; if it tested handleComplete on step 2,
# update it to test handleCliNext instead. Run all onboarding tests.
```

### Step 3: TS check

```bash
pnpm tsc --noEmit 2>&1 | grep "onboarding" | head -10
# Expected: clean
```

### Step 4: Commit

```bash
git add src/components/onboarding/onboarding-wizard.tsx src/components/onboarding/wizard-step-cli.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts src/components/onboarding/__tests__/onboarding-wizard.test.tsx
git commit -m "feat(ext-73): wire wizard step 3 + advance step 2 from complete to next"
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
| CLI test passes, click 下一步 | Advance to step 3 (Extensions) |
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

## Out of Scope (Phase 73)

- **Failure notification toast on first workspace load** — the plan originally proposed `onboarding.extensions.failed` flag for a deferred toast. Acceptable to skip in v1.2 since failures are visible in Settings → Extensions immediately. If you really want a deferred toast, add as a Phase 73.x mini-task.
- **Per-extension progress (which extension is installing now)** — current implementation shows a single global "安装中..." spinner. Per-extension progress is nice-to-have, not in scope.
- **Retry-failed-installs button in step 3** — if any install fails, the user can finish onboarding and use Settings → Extensions later. No in-wizard retry.
- **Build & Distribution** (npm pack slimming, optionalDeps) — separate v1.2.x or v1.3 milestone.

---

## After Plan Complete

Once Phase 73 is approved + executed:
- Run milestone verification across Phases 71-73
- v1.2 audit + complete-milestone (using GSD lifecycle commands or manual archive)
