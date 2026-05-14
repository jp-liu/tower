# Extensions System — Phase 72: Settings UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Extensions" tab to Settings with one card per registered extension. Each card shows install status (version + path or "未安装"), and exposes Install / Uninstall / Reinstall / 访问官网 / 重新检测 actions. Cards are driven by the registry — adding a new extension definition automatically gets a card with no UI code changes.

**Architecture:** A standalone `ExtensionsSection` component in `src/components/settings/`, registered in the existing `SECTIONS` array of `settings-page.tsx`. The section iterates over `listExtensions()` and renders an `ExtensionCard` for each, with state managed by the existing `useExtension(id)` hook. Phase 71's `ExtensionContext` is extended with an `installing: Set<ExtensionId>` field for double-click protection (per Phase 71 final review).

**Tech Stack:** Next.js 16 App Router, React 19, shadcn Button/Badge, Sonner toasts, lucide-react icons, Vitest + RTL.

---

## Files Created / Modified

**Created**
- `src/components/settings/extensions-section.tsx` — main section component
- `src/components/settings/extension-card.tsx` — single-extension card
- `src/components/settings/__tests__/extensions-section.test.tsx` — RTL smoke test

**Modified**
- `src/lib/extensions/context.tsx` — derive `INITIAL_MAP` from registry; add `installing` Set + double-click guard
- `src/lib/extensions/client.ts` — expose `isInstalling(id)` derived from context
- `src/lib/extensions/__tests__/context.test.tsx` — add cases for installing state + concurrent install guard
- `src/components/settings/settings-page.tsx` — register new "extensions" section in `SECTIONS` array + add `case "extensions":` to `renderSectionContent()`
- `src/lib/i18n/zh.ts` and `src/lib/i18n/en.ts` — add `common.loading` + `settings.extensions.*` keys
- `src/components/task/code-search.tsx` — replace hardcoded `"Loading..."` with `t("common.loading")` (Phase 71 final review minor)

**Untouched in this phase**
- `src/lib/extensions/registry.ts`, `definitions/*` — Phase 71 already provides what we need
- `src/actions/extension-actions.ts` — already covers install/uninstall/check
- `src/actions/search-code-actions.ts` dead exports (`checkRgAvailable`, `installRg`) — see Out of Scope below

---

## Test Strategy

- **Unit tests** for context updates (installing Set behavior, concurrent install guard)
- **RTL smoke test** for ExtensionsSection — render, mock hook returns, verify card appearance + button enable/disable states
- **No deep button-action tests** — Sonner toasts and pnpm subprocess execution are tested at the action layer (Phase 71). Phase 72 focuses on UI wiring.
- **Manual smoke** in Task 7: open Settings → Extensions, verify cards render correctly for installed/uninstalled rg + Monaco

---

## Task 1: Context enhancements — derive INITIAL_MAP + add installing guard

**Files:**
- Modify: `src/lib/extensions/context.tsx`
- Modify: `src/lib/extensions/client.ts`
- Modify: `src/lib/extensions/__tests__/context.test.tsx`

Phase 71's `INITIAL_MAP` is hardcoded `{ rg: …, monaco: … }`. Adding a third extension requires editing 3 files. Derive it from `listExtensions()` instead so a single registry change is enough. Also add an `installing` Set to prevent concurrent install/uninstall on the same id.

### Step 1: Update test cases first

In `src/lib/extensions/__tests__/context.test.tsx`, add two new test cases (after the existing hydration test):

```tsx
it("isInstalling becomes true while install is in flight", async () => {
  const installModule = await import("@/actions/extension-actions");
  let resolveInstall: (v: { success: boolean }) => void = () => {};
  (installModule.installExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    new Promise((r) => { resolveInstall = r; })
  );

  function InstallProbe() {
    const rg = useExtension("rg");
    return (
      <>
        <span data-testid="installing">{String(rg.isInstalling)}</span>
        <button onClick={() => rg.install()} data-testid="trigger">trigger</button>
      </>
    );
  }

  const user = userEvent.setup();
  render(
    <ExtensionProvider>
      <InstallProbe />
    </ExtensionProvider>
  );
  await waitFor(() => expect(screen.getByTestId("installing").textContent).toBe("false"));

  await user.click(screen.getByTestId("trigger"));
  // installing flips true once mock has been called and promise pending
  await waitFor(() => expect(screen.getByTestId("installing").textContent).toBe("true"));

  resolveInstall({ success: true });
  await waitFor(() => expect(screen.getByTestId("installing").textContent).toBe("false"));
});

it("rejects concurrent install on the same id", async () => {
  // Use a deferred promise so the first install is genuinely in-flight when
  // the second click fires. mockResolvedValue would resolve synchronously and
  // the guard would already have cleared by the time the second click runs,
  // making this test pass for the wrong reason.
  const installModule = await import("@/actions/extension-actions");
  let resolveInstall: (v: { success: boolean }) => void = () => {};
  (installModule.installExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    new Promise((r) => { resolveInstall = r; })
  );

  function ConcurrentProbe() {
    const rg = useExtension("rg");
    return <button onClick={() => rg.install()} data-testid="trigger">go</button>;
  }

  const user = userEvent.setup();
  render(
    <ExtensionProvider>
      <ConcurrentProbe />
    </ExtensionProvider>
  );
  // Click twice while the first install is still pending
  await user.click(screen.getByTestId("trigger"));
  await user.click(screen.getByTestId("trigger"));
  // First click should have fired one call; second click is rejected by the guard
  expect(installModule.installExtension).toHaveBeenCalledTimes(1);

  // Resolve to clean up — guarded install removes the id from installing Set in finally
  resolveInstall({ success: true });
  await waitFor(() => {
    // Eventually the first call's success flow finishes (refresh), but no second install fires
    expect(installModule.installExtension).toHaveBeenCalledTimes(1);
  });
});
```

Also add `import userEvent from "@testing-library/user-event";` and update existing test mocks to include the new fields if needed.

### Step 2: Run new tests — should fail (no installing field yet)

```bash
pnpm test:run src/lib/extensions/__tests__/context.test.tsx
# Expected: 2 new tests fail
```

### Step 3: Update `context.tsx`

Replace the hardcoded INITIAL_MAP with a registry-derived version, and add `installing: Set<ExtensionId>` state:

```tsx
"use client";

import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  checkExtension,
  installExtension,
  listAllExtensionStatus,
  uninstallExtension,
} from "@/actions/extension-actions";
import { listExtensions } from "./registry";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "./types";

type StatusMap = Record<ExtensionId, ExtensionStatus>;

const DEFAULT_STATUS: ExtensionStatus = { installed: false };

function buildInitialMap(): StatusMap {
  // Derived from registry so adding a new extension definition automatically
  // gets a default status entry.
  return Object.fromEntries(
    listExtensions().map((ext) => [ext.id, DEFAULT_STATUS])
  ) as StatusMap;
}

export interface ExtensionContextValue {
  statusMap: StatusMap;
  loading: boolean;
  installing: ReadonlySet<ExtensionId>;
  refresh(id: ExtensionId): Promise<void>;
  install(id: ExtensionId): Promise<ExtensionResult>;
  uninstall(id: ExtensionId): Promise<ExtensionResult>;
}

export const ExtensionContext = createContext<ExtensionContextValue | null>(null);

export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [statusMap, setStatusMap] = useState<StatusMap>(buildInitialMap);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<Set<ExtensionId>>(new Set());

  useEffect(() => {
    let cancelled = false;
    listAllExtensionStatus()
      .then((map) => {
        if (cancelled) return;
        setStatusMap(map);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async (id: ExtensionId) => {
    const status = await checkExtension(id);
    setStatusMap((prev) => ({ ...prev, [id]: status }));
  }, []);

  const guardedInstall = useCallback(
    async (id: ExtensionId): Promise<ExtensionResult> => {
      // Concurrent install guard — silently no-op a second click while the
      // first is in flight. Returns a synthetic "already in progress" result
      // so callers don't crash.
      let alreadyInflight = false;
      setInstalling((prev) => {
        if (prev.has(id)) {
          alreadyInflight = true;
          return prev;
        }
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (alreadyInflight) {
        return { success: false, error: "install already in progress" };
      }
      try {
        const result = await installExtension(id);
        if (result.success) await refresh(id);
        return result;
      } finally {
        setInstalling((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refresh]
  );

  const guardedUninstall = useCallback(
    async (id: ExtensionId): Promise<ExtensionResult> => {
      let alreadyInflight = false;
      setInstalling((prev) => {
        if (prev.has(id)) {
          alreadyInflight = true;
          return prev;
        }
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (alreadyInflight) {
        return { success: false, error: "operation already in progress" };
      }
      try {
        const result = await uninstallExtension(id);
        if (result.success) await refresh(id);
        return result;
      } finally {
        setInstalling((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ statusMap, loading, installing, refresh, install: guardedInstall, uninstall: guardedUninstall }),
    [statusMap, loading, installing, refresh, guardedInstall, guardedUninstall]
  );

  return (
    <ExtensionContext.Provider value={value}>
      {children}
    </ExtensionContext.Provider>
  );
}
```

### Step 4: Update `client.ts` to expose `isInstalling`

```typescript
"use client";

import { useContext } from "react";
import { ExtensionContext } from "./context";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "./types";

export interface UseExtensionReturn {
  status: ExtensionStatus;
  loading: boolean;
  isInstalling: boolean;
  install(): Promise<ExtensionResult>;
  uninstall(): Promise<ExtensionResult>;
  refresh(): Promise<void>;
}

export function useExtension(id: ExtensionId): UseExtensionReturn {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    throw new Error("useExtension must be used inside <ExtensionProvider>");
  }
  return {
    status: ctx.statusMap[id],
    loading: ctx.loading,
    isInstalling: ctx.installing.has(id),
    install: () => ctx.install(id),
    uninstall: () => ctx.uninstall(id),
    refresh: () => ctx.refresh(id),
  };
}

export function useAllExtensions() {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    throw new Error("useAllExtensions must be used inside <ExtensionProvider>");
  }
  return ctx.statusMap;
}
```

### Step 5: Run tests — all should pass

```bash
pnpm test:run src/lib/extensions/__tests__/context.test.tsx
# Expected: 3 passed (1 hydration + 2 new)
```

### Step 6: Verify no consumers broken (Phase 71 callers)

```bash
pnpm test:run src/lib/extensions/ src/actions/__tests__/extension-actions.test.ts
# Expected: all 24+ still pass
```

```bash
pnpm tsc --noEmit 2>&1 | grep -E "extensions|code-search\.tsx" | head -5
# Expected: no errors
```

### Step 7: Commit

```bash
git add src/lib/extensions/context.tsx src/lib/extensions/client.ts src/lib/extensions/__tests__/context.test.tsx
git commit -m "feat(ext-72): derive INITIAL_MAP from registry + concurrent install guard

Two improvements from Phase 71 final review:
- INITIAL_MAP now built from listExtensions() — adding a new extension
  definition no longer requires touching context.tsx
- New installing: Set<ExtensionId> tracks in-flight install/uninstall;
  duplicate calls on same id are rejected with synthetic error result.
  useExtension exposes isInstalling for UI button-disable + spinner."
```

---

## Task 2: ExtensionCard component

**Files:**
- Create: `src/components/settings/extension-card.tsx`

A self-contained card rendering a single extension's status + actions. Driven by the `Extension` definition + `useExtension(id)` hook — no per-extension UI code.

### Step 1: Implement card

```tsx
"use client";

import { useState } from "react";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useExtension } from "@/lib/extensions/client";
import type { Extension } from "@/lib/extensions/types";
import { toast } from "sonner";

interface ExtensionCardProps {
  extension: Extension;
}

export function ExtensionCard({ extension }: ExtensionCardProps) {
  const { t } = useI18n();
  const { status, loading, isInstalling, install, uninstall, refresh } = useExtension(extension.id);
  const [refreshing, setRefreshing] = useState(false);

  const Icon = extension.icon;
  const isInstalled = status.installed;

  const handleInstall = async () => {
    const result = await install();
    if (result.success) {
      toast.success(t("settings.extensions.installSuccess").replace("{name}", extension.name));
    } else {
      toast.error(
        t("settings.extensions.installFailed").replace("{name}", extension.name) +
          (result.error ? `: ${result.error.slice(0, 200)}` : "")
      );
    }
  };

  const handleUninstall = async () => {
    const result = await uninstall();
    if (result.success) {
      toast.success(t("settings.extensions.uninstallSuccess").replace("{name}", extension.name));
    } else {
      toast.error(
        t("settings.extensions.uninstallFailed").replace("{name}", extension.name) +
          (result.error ? `: ${result.error.slice(0, 200)}` : "")
      );
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenHomepage = () => {
    window.open(extension.homepageUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-xl border border-border bg-muted/50 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{extension.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{extension.description}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
          ~{extension.sizeMB} MB
        </span>
      </div>

      {/* Status row */}
      <div className="mt-4 flex items-center gap-2 text-xs">
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("common.loading")}</span>
          </>
        ) : isInstalled ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-foreground">
              {t("settings.extensions.installed")}
              {status.version ? ` v${status.version}` : ""}
            </span>
            {status.path && (
              <span className="ml-2 truncate text-muted-foreground" title={status.path}>
                {status.path}
              </span>
            )}
          </>
        ) : (
          <>
            <Circle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t("settings.extensions.notInstalledShort")}</span>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isInstalled ? (
          <>
            <Button
              variant="default"
              onClick={handleInstall}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.extensions.reinstalling")}
                </>
              ) : (
                t("settings.extensions.reinstall")
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleUninstall}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.extensions.uninstalling")}
                </>
              ) : (
                t("settings.extensions.uninstall")
              )}
            </Button>
          </>
        ) : (
          <Button
            variant="default"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("settings.extensions.installing")}
              </>
            ) : (
              t("settings.extensions.install")
            )}
          </Button>
        )}
        <Button variant="ghost" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {t("settings.extensions.recheck")}
        </Button>
        <Button variant="ghost" onClick={handleOpenHomepage}>
          <ExternalLink className="h-3.5 w-3.5" />
          {t("settings.extensions.visitHomepage")}
        </Button>
      </div>
    </div>
  );
}
```

### Step 2: Verify TS check

```bash
pnpm tsc --noEmit 2>&1 | grep "extension-card\|extensions-section" | head -5
# May error temporarily because settings-page.tsx hasn't imported it yet — OK for now.
# Should NOT error on extension-card.tsx itself.
```

### Step 3: Commit

```bash
git add src/components/settings/extension-card.tsx
git commit -m "feat(ext-72): ExtensionCard — registry-driven card with install/uninstall/refresh"
```

(No test file yet — Task 4 adds the section-level smoke test which exercises this component indirectly.)

---

## Task 3: ExtensionsSection component

**Files:**
- Create: `src/components/settings/extensions-section.tsx`

The section iterates over the registry and renders one `ExtensionCard` per extension.

### Step 1: Implement section

```tsx
"use client";

import { useI18n } from "@/lib/i18n";
import { listExtensions } from "@/lib/extensions/registry";
import { ExtensionCard } from "./extension-card";

export function ExtensionsSection() {
  const { t } = useI18n();
  const extensions = listExtensions();

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-base font-semibold">{t("settings.extensions.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.extensions.desc")}</p>
      </header>

      <div className="space-y-3">
        {extensions.map((ext) => (
          <ExtensionCard key={ext.id} extension={ext} />
        ))}
      </div>
    </div>
  );
}
```

### Step 2: Commit

```bash
git add src/components/settings/extensions-section.tsx
git commit -m "feat(ext-72): ExtensionsSection — registry-driven settings section"
```

---

## Task 4: Smoke test for ExtensionsSection

**Files:**
- Create: `src/components/settings/__tests__/extensions-section.test.tsx`

Render the section, mock the hook returns, verify card UI elements appear correctly across installed / not-installed / installing states.

### Step 1: Write tests

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExtensionsSection } from "../extensions-section";
import { ExtensionProvider } from "@/lib/extensions/context";

vi.mock("@/actions/extension-actions", () => ({
  listAllExtensionStatus: vi.fn().mockResolvedValue({
    rg: { installed: true, version: "14.1.1", path: "/usr/bin/rg" },
    monaco: { installed: false },
  }),
  checkExtension: vi.fn().mockResolvedValue({ installed: true }),
  installExtension: vi.fn().mockResolvedValue({ success: true }),
  uninstallExtension: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("ExtensionsSection", () => {
  it("renders one card per registered extension", async () => {
    render(
      <ExtensionProvider>
        <ExtensionsSection />
      </ExtensionProvider>
    );
    await waitFor(() => {
      expect(screen.getByText(/代码搜索/)).toBeInTheDocument();
      expect(screen.getByText(/代码编辑器/)).toBeInTheDocument();
    });
  });

  it("shows installed status with version for rg", async () => {
    render(
      <ExtensionProvider>
        <ExtensionsSection />
      </ExtensionProvider>
    );
    await waitFor(() => {
      expect(screen.getByText(/v14\.1\.1/)).toBeInTheDocument();
    });
  });

  it("shows not-installed marker for monaco", async () => {
    render(
      <ExtensionProvider>
        <ExtensionsSection />
      </ExtensionProvider>
    );
    await waitFor(() => {
      // Both rg (installed) and monaco (not-installed) sections present;
      // verify the "not installed" copy appears at least once.
      const nodes = screen.queryAllByText(/未安装|Not installed/i);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("install button calls installExtension and shows success toast", async () => {
    const { toast } = await import("sonner");
    const actions = await import("@/actions/extension-actions");
    const user = userEvent.setup();

    render(
      <ExtensionProvider>
        <ExtensionsSection />
      </ExtensionProvider>
    );
    await waitFor(() =>
      expect(screen.getByText(/代码编辑器/)).toBeInTheDocument()
    );

    // Find Monaco's install button (Monaco is not installed in the mock)
    const installButtons = screen.getAllByRole("button", { name: /^安装$|^Install$/ });
    expect(installButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(installButtons[0]);

    await waitFor(() => {
      expect(actions.installExtension).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
    });
  });
});
```

### Step 2: Run

```bash
pnpm test:run src/components/settings/__tests__/extensions-section.test.tsx
# Expected: 4 passed
```

### Step 3: Commit

```bash
git add src/components/settings/__tests__/extensions-section.test.tsx
git commit -m "test(ext-72): smoke test for ExtensionsSection (RTL + mocked actions)"
```

---

## Task 5: i18n keys

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

### Keys to add (both files)

`common.loading` (also fixes the Phase 71 hardcoded `"Loading..."` reuse) plus `settings.extensions.*` family.

### Step 1: Add to zh.ts

Find a logical spot — `common.*` keys cluster near top (around line 21), settings keys are spread throughout. Add `common.loading` near other `common.*` entries, and add the section block near other `settings.*` blocks (search for `"settings.notifications"` or similar to find the cluster).

Keys (zh.ts):

```typescript
// common namespace addition
"common.loading": "加载中...",

// settings.extensions.* namespace
"settings.extensions.title": "扩展",
"settings.extensions.desc": "可选扩展提供搜索 / 编辑器等功能。装一次，所有项目共享；不装不影响核心功能。",
"settings.extensions.installed": "已安装",
"settings.extensions.notInstalledShort": "未安装",
"settings.extensions.install": "安装",
"settings.extensions.installing": "安装中...",
"settings.extensions.reinstall": "重新安装",
"settings.extensions.reinstalling": "重新安装中...",
"settings.extensions.uninstall": "卸载",
"settings.extensions.uninstalling": "卸载中...",
"settings.extensions.recheck": "重新检测",
"settings.extensions.visitHomepage": "访问官网",
"settings.extensions.installSuccess": "已安装 {name}",
"settings.extensions.installFailed": "安装 {name} 失败",
"settings.extensions.uninstallSuccess": "已卸载 {name}",
"settings.extensions.uninstallFailed": "卸载 {name} 失败",
"settings.extensions.navDesc": "管理可选扩展",
```

### Step 2: Add to en.ts (matching keys)

```typescript
"common.loading": "Loading...",

"settings.extensions.title": "Extensions",
"settings.extensions.desc": "Optional extensions that enable search / editor features. Install once, shared across all projects; skipping them won't affect core functionality.",
"settings.extensions.installed": "Installed",
"settings.extensions.notInstalledShort": "Not installed",
"settings.extensions.install": "Install",
"settings.extensions.installing": "Installing...",
"settings.extensions.reinstall": "Reinstall",
"settings.extensions.reinstalling": "Reinstalling...",
"settings.extensions.uninstall": "Uninstall",
"settings.extensions.uninstalling": "Uninstalling...",
"settings.extensions.recheck": "Recheck",
"settings.extensions.visitHomepage": "Visit homepage",
"settings.extensions.installSuccess": "Installed {name}",
"settings.extensions.installFailed": "Failed to install {name}",
"settings.extensions.uninstallSuccess": "Uninstalled {name}",
"settings.extensions.uninstallFailed": "Failed to uninstall {name}",
"settings.extensions.navDesc": "Manage optional extensions",
```

### Step 3: TS check

```bash
pnpm tsc --noEmit 2>&1 | grep "i18n" | head -5
# Expected: no errors (the en.ts → zh.ts diff check enforces parity)
```

### Step 4: Commit

```bash
git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "i18n(ext-72): add common.loading + settings.extensions.* keys"
```

---

## Task 6: Wire ExtensionsSection into Settings page

**Files:**
- Modify: `src/components/settings/settings-page.tsx`

Two edits:
1. Import `ExtensionsSection`
2. Add `extensions` to `SECTIONS` array (around line 129)
3. Add `case "extensions":` to `renderSectionContent()` (around line 1845)

### Step 1: Import

Find existing imports near `BackupSection` (line 57) and add:

```tsx
import { ExtensionsSection } from "./extensions-section";
import { Package } from "lucide-react";
```

### Step 2: Register section in SECTIONS array

In the `SECTIONS` array (around line 129-172), add a new entry. Place it logically — between `config` and `notifications` works (it's a "configuration of optional functionality"):

```tsx
{
  id: "extensions",
  labelKey: "settings.extensions.title" as const,
  descKey: "settings.extensions.navDesc" as const,
  icon: Package,
  accent: "indigo",
},
```

**Accent note:** Existing accents in use are `blue, emerald, violet, amber, rose, cyan` (one per existing section). Add a new entry `indigo` to `ACCENT_STYLES` (around line 176-185 of settings-page.tsx) following the same shape as the others — copy any existing entry's CSS classes and tweak `from-indigo-500/30 to-indigo-500/10` etc. as analogous to other colors. If you don't want to add a new accent style, pick `violet` (visual collision with `prompts` is acceptable since they appear in different list positions).

### Step 3: Add case to renderSectionContent

Find the function around line 1845. Add a case before `default`:

```tsx
case "extensions":
  return <ExtensionsSection />;
```

### Step 4: TS check + smoke

```bash
pnpm tsc --noEmit 2>&1 | grep "settings-page" | head -5
# Expected: no errors

pnpm test:run src/lib/extensions/ src/actions/__tests__/extension-actions.test.ts src/components/settings/__tests__/extensions-section.test.tsx
# Expected: all green
```

### Step 5: Commit

```bash
git add src/components/settings/settings-page.tsx
git commit -m "feat(ext-72): register Extensions section in Settings sidebar + router"
```

---

## Task 7: Phase 72 verification + minor polish

**Files:**
- Modify: `src/components/task/code-search.tsx` — fix hardcoded "Loading..." (Phase 71 final review minor)

### Step 1: Fix hardcoded Loading text

Find the `if (rgLoading)` guard added in Phase 71 Task 7 (likely around line 158-163):

```tsx
if (rgLoading) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      Loading...
    </div>
  );
}
```

Replace `Loading...` with `{t("common.loading")}`.

### Step 2: Run all extension-related tests

```bash
pnpm test:run src/lib/extensions/ src/actions/__tests__/extension-actions.test.ts src/components/settings/__tests__/extensions-section.test.tsx
# Expected: all green
```

### Step 3: TS check

```bash
pnpm tsc --noEmit 2>&1 | grep -E "extensions|settings|code-search" | head -10
# Expected: no errors specific to Phase 71/72 files
```

### Step 4: Manual smoke (user verifies in browser)

| Step | Expected |
|------|----------|
| `pnpm dev` boots normally | No console errors related to ExtensionProvider |
| Settings → sidebar shows "扩展" item with Package icon | ✓ |
| Click 扩展 → renders 2 cards (rg, Monaco) | ✓ |
| Each card shows: icon, name, description, ~size, status | ✓ |
| rg card: shows ✓ Installed v14.X with path | ✓ |
| Monaco card: shows ○ Installed (because dev env has it) | ✓ |
| Click "重新检测" — spinner briefly, status refreshes | ✓ |
| Click "访问官网" — opens GitHub releases / Microsoft Monaco docs in new tab | ✓ |
| Click 卸载 (Monaco) — Loader, then 卸载成功 toast, status flips to Not installed | ✓ |
| Click 安装 (Monaco) — Loader, then 安装成功 toast, status flips back to Installed v0.55.x | ✓ |
| Settings 页面任何时候都不阻塞看板/任务页面 | ✓ |

### Step 5: Final phase commit

```bash
git add src/components/task/code-search.tsx
git commit -m "chore(ext-72): fix hardcoded Loading… in code-search"

git commit --allow-empty -m "chore(ext-72): phase 72 complete — Extensions Settings Tab

SETTING-EXT-01..04 satisfied:
- Settings page has new 扩展 section in sidebar
- Cards driven entirely by listExtensions() registry — adding a new
  extension definition automatically gets a card with no UI changes
- Concurrent install guard via isInstalling: ReadonlySet<ExtensionId>
- Inline progress state (Loader2 + 安装中...) on all action buttons
- Toast on success/failure with truncated error message

INITIAL_MAP now derived from registry (Phase 71 follow-up).
common.loading + 18 settings.extensions.* i18n keys added.

Tests: 7+ new (3 context guard tests + 4 smoke tests), all extension
tests passing.

Next: Phase 73 — Onboarding Integration"
```

---

## Out of Scope (Phase 72)

- **Removing dead `checkRgAvailable` / `installRg` exports** from `search-code-actions.ts` — not in any caller now, but the `ripgrep.ts` extension definition has its own implementation. Cleaning these up requires verifying no external consumers rely on them (legacy MCP tools, server actions). Defer to a focused cleanup phase or v1.3.
- **Onboarding wizard step** — Phase 73
- **Build/distribution slimming** (optionalDependencies, npm pack) — separate later milestone
- **Extension dependency graph** (e.g., extension A requires extension B) — none of our extensions need this; defer indefinitely
- **Network proxy / mirror configuration** for `pnpm add` — not in this milestone

---

## After Plan Complete

Once Phase 72 is reviewed + executed, write Phase 73 plan:
- `docs/superpowers/plans/2026-05-XX-extensions-phase-73.md` — Onboarding Integration
