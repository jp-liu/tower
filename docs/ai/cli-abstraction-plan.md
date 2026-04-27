# CLI 抽象层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Claude Code CLI hardcoded logic into a provider-agnostic adapter layer, preserving all existing functionality.

**Architecture:** Strategy pattern for CLI adapters (PTY execution) + generic adapters for AI queries. A ProviderRegistry maps provider names to adapters. A capability-resolver reads DB config to route each AI slot to the correct adapter.

**Tech Stack:** TypeScript, Prisma (SQLite), Next.js 16 server actions, node-pty, @anthropic-ai/claude-agent-sdk

**Spec:** `docs/ai/cli-abstraction-design.md`

---

### Task 1: Define types and error classes

**Files:**
- Create: `src/lib/ai/types.ts`

- [ ] **Step 1: Create the types file with all interfaces**

```typescript
// src/lib/ai/types.ts

// ---------------------------------------------------------------------------
// CLI Adapter — PTY execution layer
// ---------------------------------------------------------------------------

export interface CliSpawnOptions {
  taskId: string;
  prompt: string;
  cwd: string;
  envOverrides?: Record<string, string>;
  resumeSessionId?: string;
  continueLatest?: boolean;
  worktreePath?: string;
  profileArgs?: string[];
  profileEnvVars?: Record<string, string>;
}

export interface CliSpawnResult {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Gemini: spawn 后通过 PTY write 发送初始 prompt */
  initialInput?: string;
}

export interface CliAdapter {
  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult;

  buildEnvOverrides(opts: {
    taskId: string;
    taskTitle: string;
    apiUrl: string;
    callbackUrl?: string;
  }): Record<string, string>;

  installHooks(apiUrl: string): Promise<void>;
  uninstallHooks(): Promise<void>;
  isHooksInstalled(): Promise<boolean>;

  isAvailable(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  getModels(): Promise<string[]>;

  getConfigDir(): string;
  getSettingsPath(): string;
  getSessionsDir(): string;
}

// ---------------------------------------------------------------------------
// AI Query Adapter — single-turn and streaming queries
// ---------------------------------------------------------------------------

export interface AiQueryOptions {
  prompt: string;
  cwd?: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  tools?: string[];
  allowedTools?: string[];
}

export interface AiQueryResult {
  content: string | null;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AiQueryChunk {
  type: "text" | "tool_use" | "tool_result" | "error";
  content: string;
}

export interface AiQueryAdapter {
  query(opts: AiQueryOptions): Promise<AiQueryResult>;
  queryStream?(opts: AiQueryOptions): AsyncIterable<AiQueryChunk>;

  isAvailable(): Promise<boolean>;
  getModels(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Provider definition & registry types
// ---------------------------------------------------------------------------

export interface ProviderDefinition {
  name: string;
  displayName: string;
  agentFieldValue: string;

  cli?: {
    command: string;
    adapter: CliAdapter;
  };
  api?: {
    keyEnvVar: string;
    adapter: AiQueryAdapter;
  };
  cliQuery?: {
    adapter: AiQueryAdapter;
  };

  models: {
    cli: string[];
    api: string[];
  };
}

export interface ProviderAvailability {
  name: string;
  displayName: string;
  cli: { available: boolean; version: string | null };
  api: { available: boolean; keyConfigured: boolean };
}

// ---------------------------------------------------------------------------
// Capability slot config (mirrors Prisma model)
// ---------------------------------------------------------------------------

export type AiSlot = "terminal" | "summary" | "dreaming" | "analysis" | "assistant";

export interface AiSlotConfig {
  slot: AiSlot;
  provider: string;
  mode: "cli" | "api";
  model?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AiProviderErrorCode =
  | "CLI_NOT_FOUND"
  | "API_KEY_MISSING"
  | "MODEL_NOT_AVAILABLE"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UNSUPPORTED_MODE"
  | "SPAWN_FAILED";

export class AiProviderError extends Error {
  constructor(
    public code: AiProviderErrorCode,
    public provider: string,
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/liujunping/project/f/tower && npx tsc --noEmit src/lib/ai/types.ts 2>&1 | head -20`
Expected: No errors (file is self-contained, no imports needed)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/types.ts
git commit -m "feat(ai): define CLI adapter and AI query adapter interfaces"
```

---

### Task 2: Implement ClaudeCliAdapter

**Files:**
- Create: `src/lib/ai/adapters/cli/claude-cli-adapter.ts`
- Reference: `src/actions/agent-actions.ts:194-236` (resume args), `src/actions/agent-actions.ts:598-620` (env + args), `src/app/api/internal/hooks/install/route.ts` (hook install)

- [ ] **Step 1: Write the failing test**

Create: `src/lib/ai/__tests__/claude-cli-adapter.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeCliAdapter } from "../adapters/cli/claude-cli-adapter";
import type { CliSpawnOptions } from "../types";

describe("ClaudeCliAdapter", () => {
  let adapter: ClaudeCliAdapter;

  beforeEach(() => {
    adapter = new ClaudeCliAdapter();
  });

  describe("buildSpawnArgs", () => {
    const baseOpts: CliSpawnOptions = {
      taskId: "ctask123456789012345678",
      prompt: "Fix the bug",
      cwd: "/project",
    };

    it("builds fresh start args with prompt as last argument", () => {
      const result = adapter.buildSpawnArgs(baseOpts);
      expect(result.command).toBe("claude");
      expect(result.args[result.args.length - 1]).toBe("Fix the bug");
      expect(result.initialInput).toBeUndefined();
    });

    it("builds resume args with --resume flag", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        resumeSessionId: "session-abc-123",
      });
      expect(result.args).toContain("--resume");
      expect(result.args).toContain("session-abc-123");
      // resume mode should NOT include prompt as argument
      expect(result.args[result.args.length - 1]).not.toBe("Fix the bug");
    });

    it("builds continue args with --continue flag and no prompt", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        continueLatest: true,
      });
      expect(result.args).toContain("--continue");
      // continue mode should NOT include prompt as argument
      expect(result.args).not.toContain("Fix the bug");
    });

    it("merges profileArgs into args", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        profileArgs: ["--model", "opus"],
      });
      expect(result.args).toContain("--model");
      expect(result.args).toContain("opus");
    });

    it("merges profileEnvVars into env", () => {
      const result = adapter.buildSpawnArgs({
        ...baseOpts,
        profileEnvVars: { CUSTOM_VAR: "value" },
      });
      expect(result.env.CUSTOM_VAR).toBe("value");
    });
  });

  describe("buildEnvOverrides", () => {
    it("returns TOWER_* env vars", () => {
      const env = adapter.buildEnvOverrides({
        taskId: "ctask123",
        taskTitle: "Test task",
        apiUrl: "http://localhost:3000",
      });
      expect(env.TOWER_TASK_ID).toBe("ctask123");
      expect(env.TOWER_TASK_TITLE).toBe("Test task");
      expect(env.TOWER_API_URL).toBe("http://localhost:3000");
      expect(env.TOWER_STARTED_AT).toBeDefined();
    });

    it("includes CALLBACK_URL when provided", () => {
      const env = adapter.buildEnvOverrides({
        taskId: "ctask123",
        taskTitle: "Test",
        apiUrl: "http://localhost:3000",
        callbackUrl: "http://external/callback",
      });
      expect(env.CALLBACK_URL).toBe("http://external/callback");
    });

    it("omits CALLBACK_URL when not provided", () => {
      const env = adapter.buildEnvOverrides({
        taskId: "ctask123",
        taskTitle: "Test",
        apiUrl: "http://localhost:3000",
      });
      expect(env.CALLBACK_URL).toBeUndefined();
    });
  });

  describe("metadata", () => {
    it("returns correct config paths", () => {
      expect(adapter.getConfigDir()).toContain(".claude");
      expect(adapter.getSettingsPath()).toContain("settings.json");
      expect(adapter.getSessionsDir()).toContain("projects");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liujunping/project/f/tower && pnpm vitest run src/lib/ai/__tests__/claude-cli-adapter.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ClaudeCliAdapter**

```typescript
// src/lib/ai/adapters/cli/claude-cli-adapter.ts

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveCommandPathSync } from "@/lib/platform";
import type { CliAdapter, CliSpawnOptions, CliSpawnResult } from "../../types";

/** Known Claude Code model aliases (static — CLI has no list command) */
const CLAUDE_MODELS = ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

export class ClaudeCliAdapter implements CliAdapter {

  // -- spawn args ----------------------------------------------------------

  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult {
    const args: string[] = [];

    // Profile args first (e.g. --model, --dangerously-skip-permissions)
    if (opts.profileArgs?.length) {
      args.push(...opts.profileArgs);
    }

    // Mode: resume / continue / fresh
    if (opts.resumeSessionId) {
      args.push("--resume", opts.resumeSessionId);
    } else if (opts.continueLatest) {
      args.push("--continue");
    } else {
      // Fresh start: prompt as last argument
      if (opts.prompt) {
        args.push(opts.prompt);
      }
    }

    // Env: merge profile vars (adapter env built separately via buildEnvOverrides)
    const env: Record<string, string> = {
      ...(opts.profileEnvVars ?? {}),
      ...(opts.envOverrides ?? {}),
    };

    return {
      command: this.resolveCommand(),
      args,
      env,
    };
  }

  // -- env overrides -------------------------------------------------------

  buildEnvOverrides(opts: {
    taskId: string;
    taskTitle: string;
    apiUrl: string;
    callbackUrl?: string;
  }): Record<string, string> {
    const env: Record<string, string> = {
      TOWER_TASK_ID: opts.taskId,
      TOWER_TASK_TITLE: opts.taskTitle,
      TOWER_STARTED_AT: new Date().toISOString(),
      TOWER_API_URL: opts.apiUrl,
    };
    if (opts.callbackUrl) {
      env.CALLBACK_URL = opts.callbackUrl;
    }
    return env;
  }

  // -- hooks ---------------------------------------------------------------

  async installHooks(apiUrl: string): Promise<void> {
    const settings = this.readSettings();
    const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
    const entries = this.getPostToolUseArray(settings);

    if (this.findTowerHookIndex(entries) >= 0) return; // already installed

    const hookPath = path.join(process.cwd(), "scripts", "post-tool-hook.js");
    const newEntry = {
      hooks: [{ command: `node "${hookPath}"`, timeout: 10, type: "command" }],
      matcher: "Write|Edit|MultiEdit",
    };

    settings["hooks"] = { ...hooks, PostToolUse: [...entries, newEntry] };
    this.writeSettings(settings);
  }

  async uninstallHooks(): Promise<void> {
    const settings = this.readSettings();
    const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
    const entries = this.getPostToolUseArray(settings);
    const filtered = entries.filter(
      (e) => !e.hooks?.some((h: { command?: string }) => h.command?.includes("post-tool-hook.js"))
    );
    settings["hooks"] = { ...hooks, PostToolUse: filtered };
    this.writeSettings(settings);
  }

  async isHooksInstalled(): Promise<boolean> {
    const settings = this.readSettings();
    const entries = this.getPostToolUseArray(settings);
    return this.findTowerHookIndex(entries) >= 0;
  }

  // -- capability detection ------------------------------------------------

  async isAvailable(): Promise<boolean> {
    const version = await this.getVersion();
    return version !== null;
  }

  async getVersion(): Promise<string | null> {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const cmd = this.resolveCommand();
      const { stdout } = await execFileAsync(cmd, ["--version"], { timeout: 5000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async getModels(): Promise<string[]> {
    return CLAUDE_MODELS;
  }

  // -- paths ---------------------------------------------------------------

  getConfigDir(): string {
    return path.join(os.homedir(), ".claude");
  }

  getSettingsPath(): string {
    return path.join(this.getConfigDir(), "settings.json");
  }

  getSessionsDir(): string {
    return path.join(this.getConfigDir(), "projects");
  }

  // -- private helpers -----------------------------------------------------

  /** Resolve claude binary — env var > platform-aware resolution.
   *  Consolidates duplicate findClaudeBinary() from claude-session.ts + assistant route. */
  /** Resolve claude binary — env var > platform-aware resolution.
   *  Public so claude-session.ts can reuse instead of duplicating findClaudeBinary(). */
  resolveCommand(): string {
    if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
    if (process.platform === "win32") {
      const native = resolveCommandPathSync("claude-code");
      if (native !== "claude-code") return native;
    }
    return resolveCommandPathSync("claude");
  }

  private readSettings(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.getSettingsPath(), "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private writeSettings(data: Record<string, unknown>): void {
    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.getSettingsPath(), JSON.stringify(data, null, 2), "utf-8");
  }

  private getPostToolUseArray(settings: Record<string, unknown>): Array<{
    hooks: Array<{ command: string; timeout: number; type: string }>;
    matcher: string;
  }> {
    const hooks = settings["hooks"] as Record<string, unknown> | undefined;
    if (!hooks) return [];
    const arr = hooks["PostToolUse"];
    return Array.isArray(arr) ? arr : [];
  }

  private findTowerHookIndex(entries: Array<{ hooks: Array<{ command?: string }> }>): number {
    return entries.findIndex((e) =>
      e.hooks?.some((h) => h.command?.includes("post-tool-hook.js"))
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/liujunping/project/f/tower && pnpm vitest run src/lib/ai/__tests__/claude-cli-adapter.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/adapters/cli/claude-cli-adapter.ts src/lib/ai/__tests__/claude-cli-adapter.test.ts
git commit -m "feat(ai): implement ClaudeCliAdapter with tests"
```

---

### Task 3: Implement ProviderRegistry

**Files:**
- Create: `src/lib/ai/provider-registry.ts`
- Create: `src/lib/ai/providers/claude.ts`
- Create: `src/lib/ai/providers/index.ts`

- [ ] **Step 1: Write the failing test**

Create: `src/lib/ai/__tests__/provider-registry.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRegistry } from "../provider-registry";
import type { ProviderDefinition } from "../types";
import { ClaudeCliAdapter } from "../adapters/cli/claude-cli-adapter";

function makeClaudeProvider(): ProviderDefinition {
  return {
    name: "claude",
    displayName: "Claude Code",
    agentFieldValue: "CLAUDE_CODE",
    cli: {
      command: "claude",
      adapter: new ClaudeCliAdapter(),
    },
    models: {
      cli: ["sonnet", "opus", "haiku"],
      api: [],
    },
  };
}

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("registers and retrieves a provider", () => {
    registry.register(makeClaudeProvider());
    const provider = registry.get("claude");
    expect(provider).toBeDefined();
    expect(provider!.displayName).toBe("Claude Code");
  });

  it("returns undefined for unknown provider", () => {
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("returns CLI adapter for registered provider", () => {
    registry.register(makeClaudeProvider());
    const adapter = registry.getCliAdapter("claude");
    expect(adapter).toBeDefined();
  });

  it("returns null CLI adapter for provider without CLI", () => {
    registry.register({
      ...makeClaudeProvider(),
      name: "api-only",
      cli: undefined,
    });
    expect(registry.getCliAdapter("api-only")).toBeNull();
  });

  it("returns all allowed commands from registered CLI providers", () => {
    registry.register(makeClaudeProvider());
    expect(registry.getAllowedCommands()).toContain("claude");
  });

  it("lists all providers", () => {
    registry.register(makeClaudeProvider());
    expect(registry.getAll()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liujunping/project/f/tower && pnpm vitest run src/lib/ai/__tests__/provider-registry.test.ts 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Implement ProviderRegistry**

```typescript
// src/lib/ai/provider-registry.ts

import type { CliAdapter, AiQueryAdapter, ProviderDefinition, ProviderAvailability } from "./types";

export class ProviderRegistry {
  private providers = new Map<string, ProviderDefinition>();

  register(provider: ProviderDefinition): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): ProviderDefinition | undefined {
    return this.providers.get(name);
  }

  getAll(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  getCliAdapter(name: string): CliAdapter | null {
    return this.providers.get(name)?.cli?.adapter ?? null;
  }

  getQueryAdapter(name: string, mode: "api" | "cli"): AiQueryAdapter | null {
    const provider = this.providers.get(name);
    if (!provider) return null;
    if (mode === "api") return provider.api?.adapter ?? null;
    return provider.cliQuery?.adapter ?? null;
  }

  /** Returns all CLI command names from registered providers (for security allowlist). */
  getAllowedCommands(): string[] {
    const commands: string[] = [];
    for (const p of this.providers.values()) {
      if (p.cli?.command) commands.push(p.cli.command);
    }
    return commands;
  }

  async getAvailableProviders(): Promise<ProviderAvailability[]> {
    const results: ProviderAvailability[] = [];
    for (const p of this.providers.values()) {
      const cliAvailable = p.cli ? await p.cli.adapter.isAvailable() : false;
      const cliVersion = cliAvailable && p.cli ? await p.cli.adapter.getVersion() : null;
      const apiKeyConfigured = p.api ? !!process.env[p.api.keyEnvVar] : false;
      const apiAvailable = p.api ? apiKeyConfigured : false;

      results.push({
        name: p.name,
        displayName: p.displayName,
        cli: { available: cliAvailable, version: cliVersion },
        api: { available: apiAvailable, keyConfigured: apiKeyConfigured },
      });
    }
    return results;
  }
}
```

- [ ] **Step 4: Implement Claude provider definition + registration**

```typescript
// src/lib/ai/providers/claude.ts

import type { ProviderDefinition } from "../types";
import { ClaudeCliAdapter } from "../adapters/cli/claude-cli-adapter";

export function createClaudeProvider(): ProviderDefinition {
  return {
    name: "claude",
    displayName: "Claude Code",
    agentFieldValue: "CLAUDE_CODE",
    cli: {
      command: "claude",
      adapter: new ClaudeCliAdapter(),
    },
    // api and cliQuery adapters will be added in Phase 2
    models: {
      cli: ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
      api: [],
    },
  };
}
```

```typescript
// src/lib/ai/providers/index.ts

import { ProviderRegistry } from "../provider-registry";
import { createClaudeProvider } from "./claude";

// Singleton registry — survives HMR via globalThis
const g = globalThis as typeof globalThis & { __providerRegistry?: ProviderRegistry };
if (!g.__providerRegistry) {
  const registry = new ProviderRegistry();
  registry.register(createClaudeProvider());
  g.__providerRegistry = registry;
}

export const providerRegistry = g.__providerRegistry;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/liujunping/project/f/tower && pnpm vitest run src/lib/ai/__tests__/provider-registry.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/provider-registry.ts src/lib/ai/providers/claude.ts src/lib/ai/providers/index.ts src/lib/ai/__tests__/provider-registry.test.ts
git commit -m "feat(ai): implement ProviderRegistry with Claude provider"
```

---

### Task 4: Add AiCapabilityConfig Prisma model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add AiCapabilityConfig model to schema**

Add after the `CliProfile` model block (after line 218 of `prisma/schema.prisma`):

```prisma
model AiCapabilityConfig {
  id        String   @id @default(cuid())
  slot      String   @unique
  provider  String   @default("claude")
  mode      String   @default("cli")
  model     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Push schema to DB**

Run: `cd /Users/liujunping/project/f/tower && pnpm db:push 2>&1 | tail -10`
Expected: "Your database is now in sync with your Prisma schema"

- [ ] **Step 3: Verify Prisma client generated**

Run: `cd /Users/liujunping/project/f/tower && npx prisma generate 2>&1 | tail -5`
Expected: "Generated Prisma Client"

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(ai): add AiCapabilityConfig model for capability slot routing"
```

---

### Task 5: Implement capability-resolver

**Files:**
- Create: `src/lib/ai/capability-resolver.ts`
- Create: `src/actions/ai-config-actions.ts`

- [ ] **Step 1: Write the failing test**

Create: `src/lib/ai/__tests__/capability-resolver.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB before importing
vi.mock("@/lib/db", () => ({
  db: {
    aiCapabilityConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { resolveCliAdapter, resolveQueryAdapter } from "../capability-resolver";
import { providerRegistry } from "../providers";
import { db } from "@/lib/db";
import { AiProviderError } from "../types";

describe("capability-resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveCliAdapter", () => {
    it("returns Claude adapter when no config exists (default)", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue(null);
      const result = await resolveCliAdapter("terminal");
      expect(result.provider.name).toBe("claude");
      expect(result.adapter).toBeDefined();
    });

    it("returns configured provider adapter", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "claude", mode: "cli", model: "opus",
        createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await resolveCliAdapter("terminal");
      expect(result.provider.name).toBe("claude");
      expect(result.model).toBe("opus");
    });

    it("throws AiProviderError for unknown provider", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "nonexistent", mode: "cli", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await expect(resolveCliAdapter("terminal")).rejects.toThrow(AiProviderError);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liujunping/project/f/tower && pnpm vitest run src/lib/ai/__tests__/capability-resolver.test.ts 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Implement capability-resolver**

```typescript
// src/lib/ai/capability-resolver.ts

import { db } from "@/lib/db";
import { providerRegistry } from "./providers";
import { AiProviderError } from "./types";
import type { CliAdapter, AiQueryAdapter, ProviderDefinition, AiSlot } from "./types";

const DEFAULT_PROVIDER = "claude";
const DEFAULT_MODE = "cli";

interface ResolvedCliAdapter {
  adapter: CliAdapter;
  provider: ProviderDefinition;
  model?: string;
}

interface ResolvedQueryAdapter {
  adapter: AiQueryAdapter;
  provider: ProviderDefinition;
  model?: string;
}

async function loadSlotConfig(slot: AiSlot) {
  return db.aiCapabilityConfig.findUnique({ where: { slot } });
}

export async function resolveCliAdapter(slot: "terminal"): Promise<ResolvedCliAdapter> {
  const config = await loadSlotConfig(slot);
  const providerName = config?.provider ?? DEFAULT_PROVIDER;
  const model = config?.model ?? undefined;

  const providerDef = providerRegistry.get(providerName);
  if (!providerDef) {
    throw new AiProviderError("CLI_NOT_FOUND", providerName, `Provider "${providerName}" 未注册`);
  }

  const adapter = providerDef.cli?.adapter;
  if (!adapter) {
    throw new AiProviderError("UNSUPPORTED_MODE", providerName, `Provider "${providerName}" 不支持 CLI 模式`);
  }

  return { adapter, provider: providerDef, model };
}

export async function resolveQueryAdapter(
  slot: "summary" | "dreaming" | "analysis" | "assistant"
): Promise<ResolvedQueryAdapter> {
  const config = await loadSlotConfig(slot);
  const providerName = config?.provider ?? DEFAULT_PROVIDER;
  const mode = config?.mode ?? DEFAULT_MODE;
  const model = config?.model ?? undefined;

  const providerDef = providerRegistry.get(providerName);
  if (!providerDef) {
    throw new AiProviderError("CLI_NOT_FOUND", providerName, `Provider "${providerName}" 未注册`);
  }

  const adapter = providerRegistry.getQueryAdapter(providerName, mode as "api" | "cli");
  if (!adapter) {
    throw new AiProviderError(
      "UNSUPPORTED_MODE",
      providerName,
      `Provider "${providerName}" 不支持 ${mode} 查询模式`
    );
  }

  // Validate model against provider's model list for this mode
  if (model) {
    const availableModels = providerDef.models[mode as "cli" | "api"] ?? [];
    if (availableModels.length > 0 && !availableModels.includes(model)) {
      throw new AiProviderError(
        "MODEL_NOT_AVAILABLE",
        providerName,
        `模型 "${model}" 在 ${providerName} ${mode} 模式下不可用`
      );
    }
  }

  return { adapter, provider: providerDef, model };
}
```

- [ ] **Step 4: Implement ai-config-actions (server actions for Settings UI)**

```typescript
// src/actions/ai-config-actions.ts
"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { providerRegistry } from "@/lib/ai/providers";
import type { AiSlot } from "@/lib/ai/types";

const VALID_SLOTS: AiSlot[] = ["terminal", "summary", "dreaming", "analysis", "assistant"];

export async function getAiCapabilityConfigs() {
  return db.aiCapabilityConfig.findMany({ orderBy: { slot: "asc" } });
}

export async function updateAiCapabilityConfig(
  slot: string,
  data: { provider: string; mode: string; model?: string | null }
) {
  if (!VALID_SLOTS.includes(slot as AiSlot)) {
    throw new Error(`无效的插槽: ${slot}`);
  }

  // Validate provider exists
  const providerDef = providerRegistry.get(data.provider);
  if (!providerDef) {
    throw new Error(`未知的 Provider: ${data.provider}`);
  }

  // Terminal slot must be CLI mode
  if (slot === "terminal" && data.mode !== "cli") {
    throw new Error("终端执行只支持 CLI 模式");
  }

  await db.aiCapabilityConfig.upsert({
    where: { slot },
    create: {
      slot,
      provider: data.provider,
      mode: data.mode,
      model: data.model ?? null,
    },
    update: {
      provider: data.provider,
      mode: data.mode,
      model: data.model ?? null,
    },
  });

  revalidatePath("/settings");
}

export async function getAvailableProviders() {
  return providerRegistry.getAvailableProviders();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/liujunping/project/f/tower && pnpm vitest run src/lib/ai/__tests__/capability-resolver.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/capability-resolver.ts src/actions/ai-config-actions.ts src/lib/ai/__tests__/capability-resolver.test.ts
git commit -m "feat(ai): implement capability-resolver and ai-config actions"
```

---

### Task 6: Migrate agent-actions.ts to use CliAdapter

This is the critical task — rewire the existing PTY execution functions to use the adapter layer while preserving exact behavior.

**Files:**
- Modify: `src/actions/agent-actions.ts`
- Reference: `src/lib/ai/adapters/cli/claude-cli-adapter.ts`, `src/lib/ai/capability-resolver.ts`

- [ ] **Step 1: Add imports at top of agent-actions.ts**

Replace lines 6-8 of `src/actions/agent-actions.ts`:

```typescript
// Before:
import { createSession } from "@/lib/pty/session-store";
import { logger } from "@/lib/logger";
import { readConfigValue } from "@/lib/config-reader";

// After:
import { createSession } from "@/lib/pty/session-store";
import { logger } from "@/lib/logger";
import { readConfigValue } from "@/lib/config-reader";
import { resolveCliAdapter } from "@/lib/ai/capability-resolver";
```

- [ ] **Step 2: Resolve adapter + build spawn result (replaces lines 597-620)**

Replace the hardcoded env + args blocks with a single adapter flow. The adapter owns both args and env construction — the caller passes `spawnResult.env` directly to `createSession`.

```typescript
// ---- Replace lines 597-620 with: ----

const { adapter: cliAdapter, provider: providerDef, model: configuredModel } = await resolveCliAdapter("terminal");

// Build system prompt additions (instructions file + username)
let appendSystemPrompt = "";
if (instructionsFile) {
  const { readFile } = await import("fs/promises");
  appendSystemPrompt += await readFile(instructionsFile, "utf-8");
}
const usernameVal = await readConfigValue<string>("onboarding.username", "");
if (usernameVal) {
  appendSystemPrompt += (appendSystemPrompt ? "\n" : "") + `The user's name is ${usernameVal}.`;
}

// Adapter produces COMPLETE command + args + env
const spawnResult = cliAdapter.buildSpawnArgs({
  taskId,
  prompt: fullPrompt,
  cwd,
  profileArgs: [
    ...profileBaseArgs,
    ...(appendSystemPrompt ? ["--append-system-prompt", appendSystemPrompt] : []),
    ...(configuredModel ? ["--model", configuredModel] : []),
  ],
  profileEnvVars,
  envOverrides: cliAdapter.buildEnvOverrides({
    taskId,
    taskTitle: task.title,
    apiUrl: `http://localhost:${process.env.PORT || "3000"}`,
    callbackUrl: callbackUrl ?? undefined,
  }),
});
```

- [ ] **Step 3: Update createSession call to use spawnResult (line 624)**

```typescript
// Before:
createSession(
  taskId,
  profileCommand,
  claudeArgs,
  cwd,
  () => {},
  async (exitCode) => { ... },
  envOverrides,
  ...

// After — spawnResult.env replaces the separate envOverrides variable:
createSession(
  taskId,
  spawnResult.command,
  spawnResult.args,
  cwd,
  () => {},
  async (exitCode) => { ... },
  spawnResult.env,
  ...
```

- [ ] **Step 4: Update TaskExecution agent field (line 559)**

```typescript
// Before:
agent: "CLAUDE_CODE",

// After:
agent: providerDef.agentFieldValue,
```

- [ ] **Step 6: Apply same pattern to resumePtyExecution**

Apply the same adapter-based refactor to `resumePtyExecution` (lines 164-306):
- Add `resolveCliAdapter("terminal")` at the top
- Replace env overrides (lines 204-213) with `cliAdapter.buildEnvOverrides()`
- Replace Claude args (lines 229-236) with `cliAdapter.buildSpawnArgs({ resumeSessionId })`
- Replace `createSession(taskId, profileCommand, claudeArgs, ..., envOverrides, ...)` with `createSession(taskId, spawnResult.command, spawnResult.args, ..., spawnResult.env, ...)`
- `spawnResult.env` is the single source of truth — no separate `envOverrides`

- [ ] **Step 7: Apply same pattern to continueLatestPtyExecution**

Apply the same adapter-based refactor to `continueLatestPtyExecution` (lines 313-437):
- Same approach: `resolveCliAdapter` → `buildEnvOverrides` → `buildSpawnArgs({ continueLatest: true })` → pass `spawnResult.env` to `createSession`

- [ ] **Step 8: Run existing tests**

Run: `cd /Users/liujunping/project/f/tower && pnpm test:run 2>&1 | tail -30`
Expected: All existing tests PASS

- [ ] **Step 9: Manual smoke test**

Run: `cd /Users/liujunping/project/f/tower && pnpm dev`
Test: Create a task, start execution, verify Claude CLI spawns correctly, verify terminal works, verify stop/resume works.

- [ ] **Step 10: Commit**

```bash
git add src/actions/agent-actions.ts
git commit -m "refactor(ai): migrate agent-actions to use CliAdapter"
```

---

### Task 7: Update ALLOWED_COMMANDS to use registry

**Files:**
- Modify: `src/actions/cli-profile-actions.ts`

- [ ] **Step 1: Replace hardcoded ALLOWED_COMMANDS**

```typescript
// Before (line 7):
const ALLOWED_COMMANDS = ["claude", "claude-code"];

// After:
import { providerRegistry } from "@/lib/ai/providers";

function getAllowedCommands(): string[] {
  const fromRegistry = providerRegistry.getAllowedCommands();
  // Always include claude-code as alias
  return [...new Set([...fromRegistry, "claude-code"])];
}
```

- [ ] **Step 2: Update validation to use function**

```typescript
// Before (line 34):
if (!ALLOWED_COMMANDS.includes(basename)) {
  throw new Error(
    `command must be one of: ${ALLOWED_COMMANDS.join(", ")} (got: ${basename})`
  );
}

// After:
const allowed = getAllowedCommands();
if (!allowed.includes(basename)) {
  throw new Error(
    `command must be one of: ${allowed.join(", ")} (got: ${basename})`
  );
}
```

- [ ] **Step 3: Run existing cli-profile tests**

Run: `cd /Users/liujunping/project/f/tower && pnpm vitest run src/actions/__tests__/cli-profile-actions.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/actions/cli-profile-actions.ts
git commit -m "refactor(ai): derive ALLOWED_COMMANDS from ProviderRegistry"
```

---

### Task 8: Consolidate findClaudeBinary + migrate hooks route to adapter

**Files:**
- Modify: `src/lib/claude-session.ts`
- Modify: `src/app/api/internal/assistant/chat/route.ts` (has duplicate findClaudeBinary)
- Modify: `src/app/api/internal/hooks/install/route.ts` (delegate to adapter)

- [ ] **Step 1: Check for duplicate findClaudeBinary**

Run: `cd /Users/liujunping/project/f/tower && grep -rn "findClaudeBinary\|resolveCommandPathSync.*claude" src/ --include="*.ts" | grep -v node_modules | grep -v __tests__`

- [ ] **Step 2: Replace findClaudeBinary in claude-session.ts**

```typescript
// Before (lines 1-21):
import { resolveCommandPathSync } from "@/lib/platform";
// ...
function findClaudeBinary(): string { ... }

// After:
import { ClaudeCliAdapter } from "@/lib/ai/adapters/cli/claude-cli-adapter";

// Adapter resolves binary — single source of truth
const claudeAdapter = new ClaudeCliAdapter();
```

Then in `aiQuery()` (line 51), replace:
```typescript
// Before:
pathToClaudeCodeExecutable: claudePath,

// After (use adapter method — expose via public getter):
pathToClaudeCodeExecutable: claudeAdapter.resolveCommand(),
```

Note: `resolveCommand()` was already defined as public in Task 2.

- [ ] **Step 3: Migrate assistant/chat/route.ts findClaudeBinary**

Replace the duplicate `findClaudeBinary()` in `src/app/api/internal/assistant/chat/route.ts` with:
```typescript
import { ClaudeCliAdapter } from "@/lib/ai/adapters/cli/claude-cli-adapter";
const claudeAdapter = new ClaudeCliAdapter();
// Replace findClaudeBinary() calls with claudeAdapter.resolveCommand()
```

- [ ] **Step 4: Migrate hooks/install/route.ts to delegate to adapter**

Refactor `src/app/api/internal/hooks/install/route.ts` to use `ClaudeCliAdapter` for hook management:
```typescript
import { ClaudeCliAdapter } from "@/lib/ai/adapters/cli/claude-cli-adapter";
const claudeAdapter = new ClaudeCliAdapter();

// GET: return claudeAdapter.isHooksInstalled()
// POST: call claudeAdapter.installHooks(apiUrl)
// DELETE: call claudeAdapter.uninstallHooks()
```

This eliminates duplicate readSettings/writeSettings/getPostToolUseArray logic — adapter is single source of truth.

- [ ] **Step 5: Run tests**

Run: `cd /Users/liujunping/project/f/tower && pnpm test:run 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/claude-session.ts src/lib/ai/adapters/cli/claude-cli-adapter.ts src/app/api/internal/assistant/chat/route.ts src/app/api/internal/hooks/install/route.ts
git commit -m "refactor(ai): consolidate findClaudeBinary and hooks into ClaudeCliAdapter"
```

---

### Task 9: Add i18n keys for AI capability config

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

Note: i18n uses flat key format (`"section.key": "value"`), not nested JSON.

- [ ] **Step 1: Check existing i18n structure for settings**

Run: `cd /Users/liujunping/project/f/tower && grep "settings\." src/lib/i18n/zh.ts | head -10`

- [ ] **Step 2: Add zh keys**

Add to the flat export object in `src/lib/i18n/zh.ts`:

```typescript
"aiConfig.title": "AI 能力配置",
"aiConfig.description": "为每个 AI 功能场景独立配置 Provider 和模型",
"aiConfig.terminal": "终端执行",
"aiConfig.summary": "会话总结",
"aiConfig.dreaming": "知识沉淀",
"aiConfig.analysis": "项目分析",
"aiConfig.assistant": "助手聊天",
"aiConfig.provider": "Provider",
"aiConfig.mode": "模式",
"aiConfig.model": "模型",
"aiConfig.cli": "CLI（订阅）",
"aiConfig.api": "API（按量）",
"aiConfig.default": "默认",
"aiConfig.notConfigured": "未配置",
"aiConfig.cliNotFound": "CLI 未安装",
"aiConfig.apiKeyMissing": "API Key 未配置",
"aiConfig.saved": "已保存",
```

- [ ] **Step 3: Add en keys**

Add to the flat export object in `src/lib/i18n/en.ts`:

```typescript
"aiConfig.title": "AI Capability Config",
"aiConfig.description": "Configure provider and model for each AI feature independently",
"aiConfig.terminal": "Terminal Execution",
"aiConfig.summary": "Session Summary",
"aiConfig.dreaming": "Knowledge Distillation",
"aiConfig.analysis": "Project Analysis",
"aiConfig.assistant": "Assistant Chat",
"aiConfig.provider": "Provider",
"aiConfig.mode": "Mode",
"aiConfig.model": "Model",
"aiConfig.cli": "CLI (Subscription)",
"aiConfig.api": "API (Pay-per-use)",
"aiConfig.default": "Default",
"aiConfig.notConfigured": "Not configured",
"aiConfig.cliNotFound": "CLI not installed",
"aiConfig.apiKeyMissing": "API key not configured",
"aiConfig.saved": "Saved",
```

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat(i18n): add AI capability config translation keys"
```

---

### Task 10: Full regression test

- [ ] **Step 1: Run all unit tests**

Run: `cd /Users/liujunping/project/f/tower && pnpm test:run 2>&1 | tail -30`
Expected: All PASS

- [ ] **Step 2: TypeScript type check**

Run: `cd /Users/liujunping/project/f/tower && npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 3: Start dev server and smoke test**

Run: `cd /Users/liujunping/project/f/tower && pnpm dev`

Manual checks:
1. Create task → Start execution → Claude CLI spawns in terminal ✓
2. Stop execution → Summary generates ✓
3. Resume execution → `--resume` works ✓
4. Continue execution → `--continue` works ✓
5. Settings page → CLI Profile still editable ✓
6. Hook install/uninstall still works ✓

- [ ] **Step 4: Final commit with all clean-up**

```bash
git add -A
git commit -m "chore(ai): Phase 1 complete — CLI adapter layer with Claude migration"
```
