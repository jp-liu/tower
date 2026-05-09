# Extensions System — Phase 71: Detection & Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified `Extension` abstraction (registry + types + actions + client hook) that backs both ripgrep and Monaco. Replace ad-hoc `installRg` action and `copy-monaco.js` postinstall script. Detail page conditionally renders 搜索 / 文件 tabs based on extension status. Hot-reload — install/uninstall does not require app restart.

**Architecture:** Registry pattern with two `Extension` definitions (rg + monaco). Server-side `check/install/uninstall` actions wrap the definition methods. Client-side `useExtension` hook + Context provide cached status to UI; consumers use it instead of importing rg/monaco helpers directly. rg installs via `pnpm add @vscode/ripgrep` (no sudo); Monaco installs via `pnpm add monaco-editor` then runs the existing `scripts/copy-monaco.js`.

**Tech Stack:** TypeScript 5, Next.js 16 App Router, React 19, Vitest, pnpm, Sonner toasts, lucide-react icons, child_process for shell commands.

---

## Files Created / Modified

**Created**
- `src/lib/extensions/types.ts` — `Extension`, `ExtensionId`, `ExtensionStatus`, `ExtensionResult`
- `src/lib/extensions/registry.ts` — `getExtension(id)`, `listExtensions()`, registers definitions
- `src/lib/extensions/definitions/ripgrep.ts` — rg extension definition (check + install + uninstall)
- `src/lib/extensions/definitions/monaco.ts` — Monaco extension definition (check + install + uninstall)
- `src/lib/extensions/context.tsx` — React Context provider holding extension status map
- `src/lib/extensions/client.ts` — `useExtension(id)` hook + `useAllExtensions()` + provider exports
- `src/lib/extensions/__tests__/registry.test.ts`
- `src/lib/extensions/__tests__/ripgrep.test.ts`
- `src/lib/extensions/__tests__/monaco.test.ts`
- `src/actions/extension-actions.ts` — `checkExtension`, `installExtension`, `uninstallExtension`, `listAllExtensionStatus`
- `src/actions/__tests__/extension-actions.test.ts`
- `src/components/task/extension-not-installed.tsx` — small placeholder component (not used in 71 since tabs are hidden, but kept for 72 reuse)

**Modified**
- `src/components/task/code-search.tsx` — replace direct `checkRgAvailable`/`installRg` imports with `useExtension('rg')`; remove inline `<RgNotInstalled>` panel (search tab will be hidden when missing)
- `src/components/task/code-editor.tsx` — gracefully handle Monaco missing (component still renders an empty state placeholder for safety, even though parent hides the tab)
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` — filter tab list based on extension status
- `src/app/layout.tsx` — wrap with `ExtensionProvider`
- `src/actions/search-code-actions.ts` — keep `getRgPath` / `installRg` / `checkRgAvailable` as exports but mark them internal to extensions module; clear `_rgPath` cache after install
- `package.json` — remove `node scripts/copy-monaco.js && ` from `postinstall`
- `src/lib/i18n/zh.ts` and `src/lib/i18n/en.ts` — add `extensions.notInstalled.{title,desc}` keys for placeholder copy

**Untouched**
- `scripts/copy-monaco.js` itself — still functional, just no longer auto-run on npm install

---

## Test Strategy

- **Unit tests** for each extension definition (mock `execFile`, fs operations); verify check/install/uninstall behavior
- **Unit tests** for registry (`getExtension('rg')` returns rg, unknown id returns null, `listExtensions()` returns both)
- **Unit tests** for `extension-actions` (server actions delegate to registry correctly)
- **No E2E** in this phase — Phase 72 / 73 cover Settings UI + onboarding flow which warrant E2E
- **Manual smoke**: `pnpm dev`, open task detail, verify rg present → 搜索 tab visible / rg absent (rename binary) → 搜索 tab hidden

---

## Task 1: Define core types

**Files:**
- Create: `src/lib/extensions/types.ts`

- [ ] **Step 1: Write the failing test** — verify type contract with a structural assertion

```typescript
// src/lib/extensions/__tests__/types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { Extension, ExtensionId, ExtensionStatus, ExtensionResult } from "../types";

describe("Extension types", () => {
  it("ExtensionId is a union of 'rg' | 'monaco'", () => {
    expectTypeOf<ExtensionId>().toEqualTypeOf<"rg" | "monaco">();
  });

  it("ExtensionStatus has installed:boolean + optional version/path/error", () => {
    const s: ExtensionStatus = { installed: true, version: "14.1.1", path: "/usr/bin/rg" };
    expectTypeOf(s.installed).toBeBoolean();
    expectTypeOf(s.version).toEqualTypeOf<string | undefined>();
  });

  it("Extension contract requires id, name, description, icon, sizeMB, homepageUrl, check, install", () => {
    type Required = "id" | "name" | "description" | "icon" | "sizeMB" | "homepageUrl" | "check" | "install";
    expectTypeOf<keyof Extension>().toMatchTypeOf<Required | "uninstall">();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:run src/lib/extensions/__tests__/types.test.ts
# Expected: FAIL — Cannot find module '../types'
```

- [ ] **Step 3: Implement types**

```typescript
// src/lib/extensions/types.ts
import type { LucideIcon } from "lucide-react";

export type ExtensionId = "rg" | "monaco";

export interface ExtensionStatus {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface ExtensionResult {
  success: boolean;
  error?: string;
  message?: string;
}

export interface Extension {
  id: ExtensionId;
  name: string;
  description: string;
  icon: LucideIcon;
  sizeMB: number;
  homepageUrl: string;
  check(): Promise<ExtensionStatus>;
  install(): Promise<ExtensionResult>;
  uninstall?(): Promise<ExtensionResult>;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm test:run src/lib/extensions/__tests__/types.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/extensions/types.ts src/lib/extensions/__tests__/types.test.ts
git commit -m "feat(ext-71): define core Extension types"
```

---

## Task 2: Build the registry

**Files:**
- Create: `src/lib/extensions/registry.ts`
- Create: `src/lib/extensions/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/extensions/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { getExtension, listExtensions } from "../registry";

describe("registry", () => {
  it("getExtension('rg') returns the rg extension", () => {
    const ext = getExtension("rg");
    expect(ext?.id).toBe("rg");
    expect(ext?.name).toMatch(/搜索|ripgrep/i);
  });

  it("getExtension('monaco') returns the monaco extension", () => {
    const ext = getExtension("monaco");
    expect(ext?.id).toBe("monaco");
    expect(ext?.name).toMatch(/编辑|monaco/i);
  });

  it("getExtension with unknown id returns null", () => {
    // @ts-expect-error testing runtime safety against bad id
    expect(getExtension("bogus")).toBeNull();
  });

  it("listExtensions returns both definitions in deterministic order", () => {
    const list = listExtensions();
    expect(list.length).toBe(2);
    expect(list.map((e) => e.id)).toEqual(["rg", "monaco"]);
  });
});
```

- [ ] **Step 2: Run — should fail (registry doesn't exist)**

```bash
pnpm test:run src/lib/extensions/__tests__/registry.test.ts
# Expected: FAIL — Cannot find module '../registry'
```

- [ ] **Step 3: Stub the two definitions (TDD: minimal, will be filled in later tasks)**

```typescript
// src/lib/extensions/definitions/ripgrep.ts (STUB — Task 4 fills this in)
import { Search } from "lucide-react";
import type { Extension } from "../types";

export const ripgrepExtension: Extension = {
  id: "rg",
  name: "代码搜索 (ripgrep)",
  description: "基于 rg 的全文代码搜索",
  icon: Search,
  sizeMB: 5,
  homepageUrl: "https://github.com/BurntSushi/ripgrep#installation",
  async check() {
    return { installed: false };
  },
  async install() {
    return { success: false, error: "not implemented" };
  },
};
```

```typescript
// src/lib/extensions/definitions/monaco.ts (STUB — Task 5 fills this in)
import { FileCode } from "lucide-react";
import type { Extension } from "../types";

export const monacoExtension: Extension = {
  id: "monaco",
  name: "代码编辑器 (Monaco)",
  description: "VS Code 同款 Web 编辑器",
  icon: FileCode,
  sizeMB: 15,
  homepageUrl: "https://microsoft.github.io/monaco-editor/",
  async check() {
    return { installed: false };
  },
  async install() {
    return { success: false, error: "not implemented" };
  },
};
```

- [ ] **Step 4: Implement registry**

```typescript
// src/lib/extensions/registry.ts
import type { Extension, ExtensionId } from "./types";
import { ripgrepExtension } from "./definitions/ripgrep";
import { monacoExtension } from "./definitions/monaco";

const EXTENSIONS: ReadonlyArray<Extension> = [ripgrepExtension, monacoExtension] as const;

export function listExtensions(): ReadonlyArray<Extension> {
  return EXTENSIONS;
}

export function getExtension(id: ExtensionId): Extension | null {
  return EXTENSIONS.find((e) => e.id === id) ?? null;
}
```

- [ ] **Step 5: Run — should pass**

```bash
pnpm test:run src/lib/extensions/__tests__/registry.test.ts
# Expected: PASS
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/extensions/registry.ts src/lib/extensions/definitions/ src/lib/extensions/__tests__/registry.test.ts
git commit -m "feat(ext-71): registry + stub definitions for rg/monaco"
```

---

## Task 3: rg extension — full check + install + uninstall

**Files:**
- Modify: `src/lib/extensions/definitions/ripgrep.ts`
- Create: `src/lib/extensions/__tests__/ripgrep.test.ts`

The rg extension wraps existing logic. **check** is dual-track:
1. First try `require.resolve("@vscode/ripgrep")` to find the package binary path
2. If absent, fall back to `which rg` to detect a system-installed rg
3. Either succeeds → `{ installed: true, path, version }`; both fail → `{ installed: false }`

**install** runs `pnpm add @vscode/ripgrep` (no sudo). The package's own postinstall fetches the platform binary into `node_modules/@vscode/ripgrep/bin/rg`.

**uninstall** runs `pnpm remove @vscode/ripgrep` (does not touch system rg if present).

- [ ] **Step 1: Write failing tests with mocked execFile + fs**

```typescript
// src/lib/extensions/__tests__/ripgrep.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ripgrepExtension } from "../definitions/ripgrep";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("@vscode/ripgrep", () => {
  // require.resolve resolution path stub
  return { rgPath: "/repo/node_modules/@vscode/ripgrep/bin/rg" };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ripgrep extension", () => {
  it("check returns installed:true with package binary path when @vscode/ripgrep is resolvable", async () => {
    const status = await ripgrepExtension.check();
    expect(status.installed).toBe(true);
    expect(status.path).toContain("ripgrep");
  });

  // Additional cases will be filled in once implementation is in place.
  // Test runner provides scaffolding; we adjust mocks per-case.
});
```

- [ ] **Step 2: Run — fails because check returns installed:false from stub**

```bash
pnpm test:run src/lib/extensions/__tests__/ripgrep.test.ts
# Expected: FAIL — expected installed:true, got false
```

- [ ] **Step 3: Implement rg definition**

```typescript
// src/lib/extensions/definitions/ripgrep.ts
import { Search } from "lucide-react";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";

const execFileAsync = promisify(execFile);

async function runVersion(rgPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(rgPath, ["--version"], { timeout: 3000 });
    // Output: "ripgrep 14.1.1 ..."
    return stdout.split("\n")[0]?.replace(/^ripgrep\s+/, "").split(" ")[0] ?? undefined;
  } catch {
    return undefined;
  }
}

async function detectPackageBinary(): Promise<string | null> {
  try {
    const mod = await import("@vscode/ripgrep");
    const rgPath = (mod as { rgPath?: string }).rgPath;
    if (!rgPath) return null;
    return rgPath;
  } catch {
    return null;
  }
}

async function detectSystemBinary(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", ["rg"], { timeout: 3000 });
    const path = stdout.trim();
    return path || null;
  } catch {
    return null;
  }
}

async function check(): Promise<ExtensionStatus> {
  // Dual-track: package binary first, then system PATH
  const packagePath = await detectPackageBinary();
  if (packagePath) {
    const version = await runVersion(packagePath);
    return { installed: true, path: packagePath, version };
  }
  const systemPath = await detectSystemBinary();
  if (systemPath) {
    const version = await runVersion(systemPath);
    return { installed: true, path: systemPath, version };
  }
  return { installed: false };
}

async function install(): Promise<ExtensionResult> {
  try {
    await execFileAsync("pnpm", ["add", "@vscode/ripgrep"], { timeout: 120_000 });
    // Clear cached path in legacy search-code-actions if it exists
    try {
      const mod = await import("@/actions/search-code-actions");
      // @ts-expect-error mutating internal cache for hot-reload
      mod._rgPath = undefined;
    } catch {
      // Ignore — cache invalidation is best-effort
    }
    return { success: true, message: "Installed @vscode/ripgrep" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function uninstall(): Promise<ExtensionResult> {
  try {
    await execFileAsync("pnpm", ["remove", "@vscode/ripgrep"], { timeout: 60_000 });
    return { success: true, message: "Removed @vscode/ripgrep" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export const ripgrepExtension: Extension = {
  id: "rg",
  name: "代码搜索 (ripgrep)",
  description: "基于 rg 的全文代码搜索",
  icon: Search,
  sizeMB: 5,
  homepageUrl: "https://github.com/BurntSushi/ripgrep#installation",
  check,
  install,
  uninstall,
};
```

- [ ] **Step 4: Round-trip the test — check returns installed:true via the mock**

```bash
pnpm test:run src/lib/extensions/__tests__/ripgrep.test.ts
# Expected: PASS for the basic check case
```

- [ ] **Step 5: Add fall-back + failure tests, then commit**

```bash
# Tests file is incrementally extended in this same pass — write additional cases:
# - check returns installed:true via system rg when package missing
# - check returns installed:false when both missing
# - install success / failure
# - uninstall success / failure

git add src/lib/extensions/definitions/ripgrep.ts src/lib/extensions/__tests__/ripgrep.test.ts
git commit -m "feat(ext-71): rg extension — dual-track check + pnpm install/uninstall"
```

---

## Task 4: Monaco extension — full check + install + uninstall

**Files:**
- Modify: `src/lib/extensions/definitions/monaco.ts`
- Create: `src/lib/extensions/__tests__/monaco.test.ts`

**check** verifies BOTH `node_modules/monaco-editor/package.json` exists AND `public/vs/loader.js` exists. Pull `version` from the package.json. Either missing → `installed: false`.

**install** runs `pnpm add monaco-editor` then `node scripts/copy-monaco.js`.

**uninstall** runs `rm -rf public/vs` then `pnpm remove monaco-editor`.

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/extensions/__tests__/monaco.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { monacoExtension } from "../definitions/monaco";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("monaco extension", () => {
  it("check returns installed:true with version when both monaco-editor and public/vs exist", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as { mockReturnValue: (v: boolean) => void }).mockReturnValue(true);
    (fs.readFileSync as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue(
      JSON.stringify({ version: "0.55.1" })
    );

    const status = await monacoExtension.check();
    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.55.1");
  });

  // Additional cases per implementation
});
```

- [ ] **Step 2: Run — fail**

```bash
pnpm test:run src/lib/extensions/__tests__/monaco.test.ts
# Expected: FAIL — installed:false from stub
```

- [ ] **Step 3: Implement Monaco definition**

```typescript
// src/lib/extensions/definitions/monaco.ts
import { FileCode } from "lucide-react";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, rmSync } from "fs";
import path from "path";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";

const execFileAsync = promisify(execFile);

const MONACO_PKG = path.join(process.cwd(), "node_modules", "monaco-editor", "package.json");
const PUBLIC_VS_LOADER = path.join(process.cwd(), "public", "vs", "loader.js");
const PUBLIC_VS = path.join(process.cwd(), "public", "vs");
const COPY_SCRIPT = path.join(process.cwd(), "scripts", "copy-monaco.js");

async function check(): Promise<ExtensionStatus> {
  const pkgExists = existsSync(MONACO_PKG);
  const loaderExists = existsSync(PUBLIC_VS_LOADER);

  if (!pkgExists || !loaderExists) {
    return { installed: false };
  }

  let version: string | undefined;
  try {
    const pkgJson = readFileSync(MONACO_PKG, "utf-8");
    const parsed = JSON.parse(pkgJson) as { version?: string };
    version = parsed.version;
  } catch {
    // Best-effort version extraction
  }

  return { installed: true, path: PUBLIC_VS, version };
}

async function install(): Promise<ExtensionResult> {
  try {
    // Step 1: install npm package (no-op if already installed)
    await execFileAsync("pnpm", ["add", "monaco-editor"], { timeout: 180_000 });
    // Step 2: copy assets to public/vs
    await execFileAsync("node", [COPY_SCRIPT], { timeout: 60_000 });
    return { success: true, message: "Installed Monaco editor + assets" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function uninstall(): Promise<ExtensionResult> {
  try {
    if (existsSync(PUBLIC_VS)) {
      rmSync(PUBLIC_VS, { recursive: true, force: true });
    }
    await execFileAsync("pnpm", ["remove", "monaco-editor"], { timeout: 60_000 });
    return { success: true, message: "Removed Monaco editor + assets" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export const monacoExtension: Extension = {
  id: "monaco",
  name: "代码编辑器 (Monaco)",
  description: "VS Code 同款 Web 编辑器",
  icon: FileCode,
  sizeMB: 15,
  homepageUrl: "https://microsoft.github.io/monaco-editor/",
  check,
  install,
  uninstall,
};
```

- [ ] **Step 4: Run tests, add fall-back cases, then pass**

```bash
pnpm test:run src/lib/extensions/__tests__/monaco.test.ts
# Expected: PASS for happy path; round out cases:
#   - missing package.json → installed:false
#   - missing public/vs/loader.js → installed:false
#   - install success / failure
#   - uninstall success / failure
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/extensions/definitions/monaco.ts src/lib/extensions/__tests__/monaco.test.ts
git commit -m "feat(ext-71): monaco extension — fs check + pnpm + copy-script install/uninstall"
```

---

## Task 5: Server actions

**Files:**
- Create: `src/actions/extension-actions.ts`
- Create: `src/actions/__tests__/extension-actions.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/actions/__tests__/extension-actions.test.ts
import { describe, it, expect, vi } from "vitest";
import { checkExtension, listAllExtensionStatus } from "../extension-actions";

vi.mock("@/lib/extensions/registry", () => ({
  getExtension: vi.fn(),
  listExtensions: vi.fn(),
}));

describe("extension-actions", () => {
  it("checkExtension delegates to registry getExtension(id).check()", async () => {
    const mod = await import("@/lib/extensions/registry");
    const fakeExt = {
      id: "rg",
      check: vi.fn().mockResolvedValue({ installed: true, version: "14" }),
    };
    (mod.getExtension as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(fakeExt);

    const status = await checkExtension("rg");
    expect(fakeExt.check).toHaveBeenCalled();
    expect(status.installed).toBe(true);
  });

  it("checkExtension on unknown id returns installed:false + error", async () => {
    const mod = await import("@/lib/extensions/registry");
    (mod.getExtension as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(null);

    // @ts-expect-error invalid id by design
    const status = await checkExtension("bogus");
    expect(status.installed).toBe(false);
    expect(status.error).toMatch(/unknown extension/i);
  });

  it("listAllExtensionStatus returns map keyed by ext id", async () => {
    const mod = await import("@/lib/extensions/registry");
    (mod.listExtensions as unknown as { mockReturnValue: (v: unknown[]) => void }).mockReturnValue([
      { id: "rg", check: () => Promise.resolve({ installed: true }) },
      { id: "monaco", check: () => Promise.resolve({ installed: false }) },
    ]);
    const all = await listAllExtensionStatus();
    expect(all.rg.installed).toBe(true);
    expect(all.monaco.installed).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
pnpm test:run src/actions/__tests__/extension-actions.test.ts
# Expected: FAIL — Cannot find module '../extension-actions'
```

- [ ] **Step 3: Implement actions**

```typescript
// src/actions/extension-actions.ts
"use server";

import { getExtension, listExtensions } from "@/lib/extensions/registry";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "@/lib/extensions/types";

export async function checkExtension(id: ExtensionId): Promise<ExtensionStatus> {
  const ext = getExtension(id);
  if (!ext) return { installed: false, error: `unknown extension: ${id}` };
  return ext.check();
}

export async function installExtension(id: ExtensionId): Promise<ExtensionResult> {
  const ext = getExtension(id);
  if (!ext) return { success: false, error: `unknown extension: ${id}` };
  return ext.install();
}

export async function uninstallExtension(id: ExtensionId): Promise<ExtensionResult> {
  const ext = getExtension(id);
  if (!ext) return { success: false, error: `unknown extension: ${id}` };
  if (!ext.uninstall) return { success: false, error: `extension ${id} does not support uninstall` };
  return ext.uninstall();
}

export async function listAllExtensionStatus(): Promise<Record<ExtensionId, ExtensionStatus>> {
  const exts = listExtensions();
  const entries = await Promise.all(
    exts.map(async (e) => [e.id, await e.check()] as const)
  );
  return Object.fromEntries(entries) as Record<ExtensionId, ExtensionStatus>;
}
```

- [ ] **Step 4: Run — pass**

```bash
pnpm test:run src/actions/__tests__/extension-actions.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/actions/extension-actions.ts src/actions/__tests__/extension-actions.test.ts
git commit -m "feat(ext-71): server actions — check/install/uninstall/listAll"
```

---

## Task 6: Client hook + Context provider

**Files:**
- Create: `src/lib/extensions/context.tsx`
- Create: `src/lib/extensions/client.ts`
- Modify: `src/app/layout.tsx`

The provider mounts at root, calls `listAllExtensionStatus()` once, stores in state, and exposes per-id mutations (`install`, `uninstall`, `refresh`). Each consumer uses `useExtension(id)` and gets memoized status + actions.

- [ ] **Step 1: Write a smoke test (component-level via React Testing Library)**

```typescript
// src/lib/extensions/__tests__/context.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ExtensionProvider } from "../context";
import { useExtension } from "../client";

vi.mock("@/actions/extension-actions", () => ({
  listAllExtensionStatus: vi.fn().mockResolvedValue({
    rg: { installed: true, version: "14.1.1" },
    monaco: { installed: false },
  }),
  checkExtension: vi.fn(),
  installExtension: vi.fn(),
  uninstallExtension: vi.fn(),
}));

function Probe() {
  const rg = useExtension("rg");
  const monaco = useExtension("monaco");
  return (
    <>
      <span data-testid="rg-installed">{String(rg.status.installed)}</span>
      <span data-testid="rg-version">{rg.status.version ?? ""}</span>
      <span data-testid="monaco-installed">{String(monaco.status.installed)}</span>
    </>
  );
}

describe("ExtensionProvider + useExtension", () => {
  it("hydrates initial status and propagates to consumers", async () => {
    render(
      <ExtensionProvider>
        <Probe />
      </ExtensionProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("rg-installed").textContent).toBe("true");
      expect(screen.getByTestId("rg-version").textContent).toBe("14.1.1");
      expect(screen.getByTestId("monaco-installed").textContent).toBe("false");
    });
  });
});
```

- [ ] **Step 2: Run — fail (modules don't exist)**

```bash
pnpm test:run src/lib/extensions/__tests__/context.test.tsx
# Expected: FAIL — Cannot find module '../context'
```

- [ ] **Step 3: Implement Context**

```typescript
// src/lib/extensions/context.tsx
"use client";

import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  checkExtension,
  installExtension,
  listAllExtensionStatus,
  uninstallExtension,
} from "@/actions/extension-actions";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "./types";

type StatusMap = Record<ExtensionId, ExtensionStatus>;

const DEFAULT_STATUS: ExtensionStatus = { installed: false };
const INITIAL_MAP: StatusMap = { rg: DEFAULT_STATUS, monaco: DEFAULT_STATUS };

export interface ExtensionContextValue {
  statusMap: StatusMap;
  loading: boolean;
  refresh(id: ExtensionId): Promise<void>;
  install(id: ExtensionId): Promise<ExtensionResult>;
  uninstall(id: ExtensionId): Promise<ExtensionResult>;
}

export const ExtensionContext = createContext<ExtensionContextValue | null>(null);

export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [statusMap, setStatusMap] = useState<StatusMap>(INITIAL_MAP);
  const [loading, setLoading] = useState(true);

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
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (id: ExtensionId) => {
    const status = await checkExtension(id);
    setStatusMap((prev) => ({ ...prev, [id]: status }));
  }, []);

  const install = useCallback(
    async (id: ExtensionId): Promise<ExtensionResult> => {
      const result = await installExtension(id);
      if (result.success) await refresh(id);
      return result;
    },
    [refresh]
  );

  const uninstall = useCallback(
    async (id: ExtensionId): Promise<ExtensionResult> => {
      const result = await uninstallExtension(id);
      if (result.success) await refresh(id);
      return result;
    },
    [refresh]
  );

  return (
    <ExtensionContext.Provider value={{ statusMap, loading, refresh, install, uninstall }}>
      {children}
    </ExtensionContext.Provider>
  );
}
```

- [ ] **Step 4: Implement client hook**

```typescript
// src/lib/extensions/client.ts
"use client";

import { useContext } from "react";
import { ExtensionContext } from "./context";
import type { ExtensionId } from "./types";

export interface UseExtensionReturn {
  status: import("./types").ExtensionStatus;
  loading: boolean;
  install(): Promise<import("./types").ExtensionResult>;
  uninstall(): Promise<import("./types").ExtensionResult>;
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

- [ ] **Step 5: Run smoke test — pass**

```bash
pnpm test:run src/lib/extensions/__tests__/context.test.tsx
# Expected: PASS
```

- [ ] **Step 6: Wire into root layout**

Find the root layout (likely `src/app/layout.tsx`). Wrap the children with `<ExtensionProvider>`. Read the file first to understand existing wrapping structure (I18nProvider, ThemeProvider, etc.), then place inside the closest place that has access to client-side state (likely after I18nProvider).

```bash
# Inspect first
cat src/app/layout.tsx
```

Add import:

```tsx
import { ExtensionProvider } from "@/lib/extensions/context";
```

Wrap children:

```tsx
<ExtensionProvider>{children}</ExtensionProvider>
```

- [ ] **Step 7: Verify dev server boots without errors**

```bash
pnpm tsc --noEmit
# Expected: no errors involving extensions/
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/extensions/context.tsx src/lib/extensions/client.ts src/lib/extensions/__tests__/context.test.tsx src/app/layout.tsx
git commit -m "feat(ext-71): ExtensionProvider + useExtension hook + root layout wiring"
```

---

## Task 7: Migrate code-search.tsx to useExtension

**Files:**
- Modify: `src/components/task/code-search.tsx`
- Modify: `src/actions/search-code-actions.ts` (mark internal helpers, ensure cache invalidation works)

The current `code-search.tsx`:
1. Imports `checkRgAvailable` and `installRg` from `search-code-actions.ts`
2. Inside the component, calls `checkRgAvailable()` on mount, stores `rgAvailable` boolean
3. Renders an inline `<RgNotInstalled>` panel when `!rgAvailable`
4. Has an `installRg` button that triggers shell install

After migration:
1. Use `useExtension('rg')` instead
2. Remove the inline panel — Phase 71 EXT-07 will hide the entire 搜索 tab in `task-page-client.tsx`, so `code-search.tsx` only needs to assume rg is available
3. Keep the `searchCode` server action import (still needed)
4. `installRg` import removed; install moves to Settings (Phase 72)

- [ ] **Step 1: Read current code-search.tsx top section**

```bash
sed -n '1,80p' src/components/task/code-search.tsx
```

- [ ] **Step 2: Update imports**

Remove:
```tsx
import { searchCode, checkRgAvailable, installRg } from "@/actions/search-code-actions";
```

Add:
```tsx
import { searchCode } from "@/actions/search-code-actions";
import { useExtension } from "@/lib/extensions/client";
```

- [ ] **Step 3: Remove the rg-checked / rg-available state and inline panel**

Replace this block (around lines 70-83):
```tsx
const [rgChecked, setRgChecked] = useState(false);
const [rgAvailable, setRgAvailable] = useState(true);
const [installing, setInstalling] = useState(false);

useEffect(() => {
  checkRgAvailable().then((res) => {
    setRgAvailable(res.available);
    setRgChecked(true);
  });
}, []);
```

With:
```tsx
const { status: rgStatus, loading: rgLoading } = useExtension("rg");
```

- [ ] **Step 4: Remove the `handleInstallRg` callback and the `rgNotInstalled` JSX block** (the early-return panel around lines 188-219). The whole branch goes away.

Add a guard at the top of the render:
```tsx
if (rgLoading) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {t("common.loading")}
    </div>
  );
}
// rg should always be available when this component renders (parent filters tabs).
// But guard defensively.
if (!rgStatus.installed) {
  return null;
}
```

- [ ] **Step 5: Search for any other `checkRgAvailable`/`installRg` references**

```bash
grep -rn "checkRgAvailable\|installRg" src --include="*.ts" --include="*.tsx" | grep -v "search-code-actions.ts"
# Expected output: nothing — all consumers go through useExtension('rg') now.
```

- [ ] **Step 6: TS check**

```bash
pnpm tsc --noEmit 2>&1 | grep "code-search\|search-code-actions"
# Expected: no errors
```

- [ ] **Step 7: Commit**

```bash
git add src/components/task/code-search.tsx
git commit -m "refactor(ext-71): code-search uses useExtension('rg'), drops inline rg install panel"
```

---

## Task 8: Conditional tab rendering in task detail page

**Files:**
- Modify: `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx`

Find the tab list. Search/file tabs are rendered when their respective extension is installed. Currently the tab list is a static array. We make it dependent on extension state.

- [ ] **Step 1: Locate the tab definition**

```bash
grep -n "code-search\|file-tree\|code-editor\|tabs\|<TabsTrigger\|<TabsContent" src/app/workspaces/\[workspaceId\]/tasks/\[taskId\]/task-page-client.tsx | head -20
```

- [ ] **Step 2: Read the surrounding code (~30 lines around match)** so the implementation matches actual structure (current code uses shadcn Tabs).

- [ ] **Step 3: Build the filtered tab list**

```tsx
import { useExtension } from "@/lib/extensions/client";

// inside component body:
const { status: rgStatus } = useExtension("rg");
const { status: monacoStatus } = useExtension("monaco");

const tabs = useMemo(() => {
  return [
    monacoStatus.installed && { value: "files", label: t("taskPage.tabs.files"), Component: FileTreePanel },
    monacoStatus.installed && { value: "diff", label: t("taskPage.tabs.diff"), Component: DiffPanel },
    rgStatus.installed && { value: "search", label: t("taskPage.tabs.search"), Component: CodeSearch },
    { value: "preview", label: t("taskPage.tabs.preview"), Component: PreviewPanel },
    { value: "terminal", label: t("taskPage.tabs.terminal"), Component: TerminalPanel },
  ].filter(Boolean) as { value: string; label: string; Component: ComponentType }[];
}, [rgStatus.installed, monacoStatus.installed, t]);
```

(Adjust to actual tab structure — the above is illustrative; preserve all current tab IDs and component references.)

- [ ] **Step 4: Make sure the default-active tab logic falls back gracefully**

If the user was on "search" tab and rg gets uninstalled, switch to first available tab. Use `useEffect` on `tabs` change.

- [ ] **Step 5: TS check + smoke test**

```bash
pnpm tsc --noEmit 2>&1 | grep "task-page-client"
# Expected: no errors
```

- [ ] **Step 6: Commit**

```bash
git add src/app/workspaces/\[workspaceId\]/tasks/\[taskId\]/task-page-client.tsx
git commit -m "feat(ext-71): hide 搜索 / 文件 tabs when their extension is missing"
```

---

## Task 9: Decouple Monaco copy from npm postinstall

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current postinstall**

```bash
grep -A 1 '"postinstall"' package.json
```

Current value:
```json
"postinstall": "node scripts/copy-monaco.js && node scripts/generate-prisma-client.js && node scripts/link-prisma.js && node scripts/fix-native-permissions.js"
```

- [ ] **Step 2: Edit `package.json` — remove `node scripts/copy-monaco.js && `**

New value:
```json
"postinstall": "node scripts/generate-prisma-client.js && node scripts/link-prisma.js && node scripts/fix-native-permissions.js"
```

- [ ] **Step 3: Verify `pnpm install` doesn't break** (note: this won't trigger copy-monaco on next install, which is intentional)

```bash
# Don't actually re-run pnpm install yet — we don't want to wipe public/vs.
# Just confirm the script change is well-formed.
node -e "console.log(require('./package.json').scripts.postinstall)"
# Expected: prints new postinstall string without copy-monaco
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build(ext-71): decouple Monaco copy from npm postinstall

The copy-monaco.js script remains, but is now triggered exclusively by
installExtension('monaco'). Fresh installs of Tower no longer pre-load
the 15MB Monaco assets — users opt in via the Extensions onboarding step
or Settings."
```

---

## Task 10: i18n keys for placeholder copy (used by Phase 72 + safety in code-editor)

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

- [ ] **Step 1: Add new keys (zh)**

```typescript
"extensions.notInstalled.title": "扩展未安装",
"extensions.notInstalled.desc": "需要先安装对应扩展才能使用此功能",
```

- [ ] **Step 2: Same keys in en**

```typescript
"extensions.notInstalled.title": "Extension not installed",
"extensions.notInstalled.desc": "Install this extension to enable the feature",
```

- [ ] **Step 3: TS check**

```bash
pnpm tsc --noEmit 2>&1 | grep i18n
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "i18n(ext-71): add extensions.notInstalled keys for Phase 72 reuse"
```

---

## Task 11: Phase verification + smoke test

- [ ] **Step 1: Run full extension test suite**

```bash
pnpm test:run src/lib/extensions/ src/actions/__tests__/extension-actions.test.ts
# Expected: all green
```

- [ ] **Step 2: TS check across whole project**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "extension|search-code|code-search|task-page|layout" | head -20
# Expected: no new errors related to phase 71 files
```

- [ ] **Step 3: Manual smoke (user verifies in browser)**

| Step | Expected |
|------|----------|
| `pnpm dev` boots normally | No console errors mentioning ExtensionProvider / useExtension |
| Open a task detail page (rg + Monaco both currently installed in dev env) | All tabs visible, search works, file tree works |
| Temporarily rename `node_modules/@vscode/ripgrep/bin/rg` to `rg.bak` | After hard refresh: 搜索 tab disappears |
| Restore the binary | After hard refresh (or click "重新检测" once Phase 72 ships): 搜索 tab reappears |
| Temporarily `mv public/vs public/vs.bak` | After hard refresh: 文件 tab disappears |
| Restore | 文件 tab reappears |

- [ ] **Step 4: Final commit (release notes for the phase)**

```bash
git commit --allow-empty -m "chore(ext-71): phase 71 complete — Extension Detection & Wiring

EXT-01..09 satisfied:
- types / registry / definitions / hooks / context all in place
- rg + Monaco extensions wrapped with consistent check/install/uninstall
- code-search migrates to useExtension; tabs hide when extensions missing
- postinstall no longer auto-copies Monaco assets
- 18 unit tests across registry, ripgrep, monaco, extension-actions, context

Next: Phase 72 — Extensions Settings Tab (cards + buttons in Settings)"
```

---

## Out of Scope (Phase 71)

- Settings UI for managing extensions — Phase 72
- Onboarding wizard step — Phase 73
- `monaco-editor` → `optionalDependencies` migration — deferred to Phase 74 / v1.3
- Real plugin manifest system — out of scope for the whole milestone

---

## After Plan Complete

Once Phase 71 plan is reviewed + executed, write the next plan documents:
- `docs/superpowers/plans/2026-05-XX-extensions-phase-72.md` — Settings tab
- `docs/superpowers/plans/2026-05-XX-extensions-phase-73.md` — Onboarding integration
