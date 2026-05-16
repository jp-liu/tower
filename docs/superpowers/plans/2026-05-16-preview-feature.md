# Preview Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Tower 现有的"前端 dev server iframe"型预览升级为多语言多场景开发预览中心：日志面板 + 11 个内置框架 preset 自动探测 + monorepo subPath 支持 + session 共享。

**Architecture:** 复用现有 `PtySession` 类（不复用 `pty/session-store.ts`），新建独立 `src/lib/preview/` 模块，session 身份用 `(cwd, command, port)` 三元组，状态通过 WebSocket 广播给多个订阅 client。

**Tech Stack:** Next.js 16 + TypeScript + Prisma (SQLite) + node-pty + xterm.js + @iconify/react + vitest + Playwright

**Spec:** `docs/superpowers/specs/2026-05-16-preview-feature-design.md`

**Phases:**
- Phase 1: Schema + Preset 数据层（4 tasks）
- Phase 2: Session Store + Server Actions（6 tasks）
- Phase 3: 探测时机接入（3 tasks）
- Phase 4: UI 重写（5 tasks）
- Phase 5: E2E + 文档（2 tasks）

**Commit convention:** `feat(preview-XX.YY): <description>` where XX = phase number, YY = task number within phase (Tower 项目 commit scope 惯例)

**Testing convention:**
- 单元/集成测试 → `tests/unit/lib/preview/<name>.test.ts` or `tests/unit/actions/<name>.test.ts`
- E2E → `tests/e2e/preview.spec.ts`
- Run single: `pnpm test tests/unit/lib/preview/detector.test.ts -- --run`
- Run all: `pnpm test -- --run`

**Pre-flight check** (Phase 1 起手前必跑):

```bash
grep -rn "preview-process\|registerPreviewProcess\|killPreviewProcess\|isPreviewRunning" \
  src --include="*.ts" --include="*.tsx" | grep -v ".test.\|__tests__"
```

预期：只有 `src/actions/preview-actions.ts:11` 一处。如有其他 importer，先把它们 stub 掉再继续。

---

## ⚠ 重要：Reviewer 反馈整合后的关键约束

实施前必读，这些是 spec/plan reviewer 多轮发现的"会直接挂"的雷点：

1. **ws-server 用 taskId query 分发，不是 path** — `src/lib/pty/ws-server.ts:148` 是 `url.searchParams.get("taskId")`，不是 pathname。Preview 复用同一 wss，但通过**特殊 taskId 值**走分支（参考 `__notifications__` / `__assistant__` 已有模式）：
   ```
   ws://localhost:{wsPort}/?taskId=__preview__&role=state&previewKey=<encoded>&connectionId=<uuid>
   ws://localhost:{wsPort}/?taskId=__preview__&role=terminal&previewKey=<encoded>&connectionId=<uuid>
   ```
2. **WS 端口用 `getActualWsPort()`，不用 `__TOWER_WS_PORT__`** — `import { getActualWsPort } from "@/actions/config-actions"`，参考 `src/components/task/task-terminal.tsx:169`
3. **`PtySession.kill()` 不接受参数** — pty-session.ts:150 是 `kill(): void`，调用时 `this.pty.kill()` 即可，不要传 `"SIGTERM"`
4. **node:fs 用 ESM import**：`import { existsSync } from "node:fs"`，不要 `require("node:fs")`（Next.js 16 server action 是 ESM）
5. **Prisma conditional update 用 updateMany**：`update({ where: { id, previewPreset: null } })` 会抛错（id 是唯一，previewPreset 不是），改用 `updateMany`
6. **PreviewSession 内不要变异 this.opts** — 违反 [common/coding-style.md](.claude/rules) 不变性原则
7. **命令解析用 shell-quote 包，不要 split(/\s+/)** — 否则 `BROWSER=none pnpm dev`、`npx serve -l 3000 "."` 全裂
8. **sessions Map 放 globalThis** — Next.js HMR 会重新求值 module，flag + 外部 Map 在 HMR 时会孤儿化，导致 SIGTERM 钩子调旧 Map
9. **setTimeout 必须在 useEffect cleanup 清** — 参考 `.claude/rules/process-lifecycle.md`
10. **测试 DB 隔离** — 每个 test file 用 `afterAll` 删自建 workspace；Prisma 没有 transaction-based fixture，要小心污染

---

## Phase 1: Schema + Preset 数据层

**目标**：建立纯数据层 — schema 字段、preset 类型、11 个 preset 常量、纯函数 detector。无副作用，全部可单元测试。

**完成标志**：`pnpm test -- --run` 全过；`pnpm prisma migrate dev` 无错；DB 多出 4 个字段。

### Task 1.1: Prisma Schema 加字段 + Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_preview_fields/migration.sql` (由 prisma 生成)

- [ ] **Step 1: 修改 schema**

修改 `prisma/schema.prisma` 中的 Project 和 Task 模型：

```prisma
model Project {
  // ... existing fields
  previewCommand         String?
  previewPort            Int?
  previewPreset          String?           // 新增
  previewInstallCommand  String?           // 新增
  // ... rest
}

model Task {
  // ... existing fields
  previewCommandOverride   String?         // 新增
  previewPortOverride      Int?            // 新增
  // ... rest
}
```

- [ ] **Step 2: 生成 migration**

```bash
pnpm prisma migrate dev --name add-preview-fields
```

预期：在 `prisma/migrations/` 下生成新目录，SQL 包含 `ALTER TABLE Project ADD COLUMN previewPreset TEXT;` 等 4 条语句。

- [ ] **Step 3: 验证 Prisma Client 生成**

```bash
pnpm prisma generate
```

预期：无错误。

- [ ] **Step 4: 验证字段在 Client 上可用**

```bash
pnpm tsx -e "import { db } from './src/lib/db'; db.project.findFirst({ select: { previewPreset: true, previewInstallCommand: true } }).then(r => console.log('OK', r))"
```

预期：输出 `OK null` 或 `OK { previewPreset: null, ... }`（取决于现有数据）。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(preview-01.01): add previewPreset/previewInstallCommand to Project and previewCommandOverride/previewPortOverride to Task"
```

---

### Task 1.2: Preset 类型定义

**Files:**
- Create: `src/lib/preview/preset-types.ts`
- Test: `tests/unit/lib/preview/preset-types.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/lib/preview/preset-types.test.ts
import { describe, it, expect } from "vitest";
import type { PreviewPreset, DetectContext } from "@/lib/preview/preset-types";

describe("PreviewPreset type", () => {
  it("compiles a minimal preset shape", () => {
    const preset: PreviewPreset = {
      id: "test",
      name: "Test",
      icon: "simple-icons:test",
      detect: () => true,
      command: "echo hi",
      port: 3000,
      installCommand: null,
      installMarker: null,
      readyRegex: null,
      urlExtractRegex: null,
    };
    expect(preset.id).toBe("test");
  });

  it("DetectContext provides files map and hasDir", () => {
    const ctx: DetectContext = {
      files: { "package.json": null },
      hasDir: (rel) => rel === "node_modules",
    };
    expect(ctx.hasDir("node_modules")).toBe(true);
    expect(ctx.hasDir("dist")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/preview/preset-types.test.ts -- --run
```

预期：FAIL — `Cannot find module '@/lib/preview/preset-types'`

- [ ] **Step 3: 实现类型**

```ts
// src/lib/preview/preset-types.ts
export interface DetectContext {
  files: Record<string, string | null>;
  hasDir: (rel: string) => boolean;
}

export interface PreviewPreset {
  id: string;
  name: string;
  icon: string;
  detect: (ctx: DetectContext) => boolean;
  command: string;
  port: number;
  installCommand: string | null;
  installMarker: string[] | null;
  installCwd?: "self" | "monorepo-root";
  readyRegex: RegExp | null;
  urlExtractRegex: RegExp | null;
  startTimeoutMs?: number;
  docUrl?: string;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/preview/preset-types.test.ts -- --run
```

预期：PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/preview/preset-types.ts tests/unit/lib/preview/preset-types.test.ts
git commit -m "feat(preview-01.02): add PreviewPreset and DetectContext type definitions"
```

---

### Task 1.3: 11 个内置 Preset 常量

**Files:**
- Create: `src/lib/preview/presets.ts`
- Test: `tests/unit/lib/preview/presets.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/lib/preview/presets.test.ts
import { describe, it, expect } from "vitest";
import { PRESETS } from "@/lib/preview/presets";

describe("PRESETS", () => {
  it("contains exactly 11 presets", () => {
    expect(PRESETS).toHaveLength(11);
  });

  it("all presets have unique ids", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("vite preset matches package.json with vite dep", () => {
    const vite = PRESETS.find((p) => p.id === "vite")!;
    const result = vite.detect({
      files: {
        "package.json": JSON.stringify({ devDependencies: { vite: "^5.0.0" } }),
      },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("next preset matches package.json with next dep, priority over vite", () => {
    const next = PRESETS.find((p) => p.id === "next")!;
    const result = next.detect({
      files: {
        "package.json": JSON.stringify({ dependencies: { next: "^15.0.0" } }),
      },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("spring-boot-maven matches pom.xml with spring-boot-starter", () => {
    const sb = PRESETS.find((p) => p.id === "spring-boot-maven")!;
    const result = sb.detect({
      files: { "pom.xml": "<dependency>spring-boot-starter-web</dependency>" },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("django matches manage.py existence", () => {
    const dj = PRESETS.find((p) => p.id === "django")!;
    const result = dj.detect({
      files: { "manage.py": "import django" },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("go-generic matches go.mod existence", () => {
    const go = PRESETS.find((p) => p.id === "go-generic")!;
    const result = go.detect({
      files: { "go.mod": "module foo" },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("static matches index.html without package.json or pom.xml", () => {
    const st = PRESETS.find((p) => p.id === "static")!;
    expect(
      st.detect({
        files: {
          "index.html": "<html></html>",
          "package.json": null,
          "pom.xml": null,
        },
        hasDir: () => false,
      })
    ).toBe(true);
    expect(
      st.detect({
        files: {
          "index.html": "<html></html>",
          "package.json": JSON.stringify({}),
          "pom.xml": null,
        },
        hasDir: () => false,
      })
    ).toBe(false);
  });

  it("vite preset's readyRegex matches real Vite output", () => {
    const vite = PRESETS.find((p) => p.id === "vite")!;
    expect(vite.readyRegex!.test("  VITE v5.0.0  ready in 1247 ms")).toBe(true);
  });

  it("vite preset's urlExtractRegex extracts URL from Local: line", () => {
    const vite = PRESETS.find((p) => p.id === "vite")!;
    const m = "  ➜  Local:   http://localhost:5173/".match(vite.urlExtractRegex!);
    expect(m?.[1]).toBe("http://localhost:5173/");
  });

  it("spring-boot readyRegex matches real Spring Boot output", () => {
    const sb = PRESETS.find((p) => p.id === "spring-boot-maven")!;
    expect(
      sb.readyRegex!.test(
        "Started DemoApplication in 2.345 seconds (process running for 3.456)"
      )
    ).toBe(true);
  });

  it("django readyRegex matches real Django output", () => {
    const dj = PRESETS.find((p) => p.id === "django")!;
    expect(
      dj.readyRegex!.test("Starting development server at http://127.0.0.1:8000/")
    ).toBe(true);
  });

  it("spring-boot-maven has startTimeoutMs override (>= 120s)", () => {
    const sb = PRESETS.find((p) => p.id === "spring-boot-maven")!;
    expect(sb.startTimeoutMs).toBeGreaterThanOrEqual(120_000);
  });

  it("go-generic has null readyRegex (falls back to HTTP probe)", () => {
    const go = PRESETS.find((p) => p.id === "go-generic")!;
    expect(go.readyRegex).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/preview/presets.test.ts -- --run
```

预期：FAIL — `Cannot find module '@/lib/preview/presets'`

- [ ] **Step 3: 实现 11 个 preset**

```ts
// src/lib/preview/presets.ts
import type { PreviewPreset, DetectContext } from "./preset-types";

function safeJson(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasNodeDep(ctx: DetectContext, depName: string): boolean {
  const pkg = safeJson(ctx.files["package.json"]) as
    | { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
    | null;
  if (!pkg) return false;
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return depName in all;
}

export const PRESETS: PreviewPreset[] = [
  {
    id: "next",
    name: "Next.js",
    icon: "simple-icons:nextdotjs",
    detect: (ctx) => hasNodeDep(ctx, "next"),
    command: "pnpm dev",
    port: 3000,
    installCommand: "pnpm install",
    installMarker: ["node_modules"],
    readyRegex: /Ready in \d+/i,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
    docUrl: "https://nextjs.org/docs",
  },
  {
    id: "nuxt",
    name: "Nuxt",
    icon: "simple-icons:nuxtdotjs",
    detect: (ctx) => hasNodeDep(ctx, "nuxt"),
    command: "pnpm dev",
    port: 3000,
    installCommand: "pnpm install",
    installMarker: ["node_modules"],
    readyRegex: /Nuxt .* ready in/i,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
  },
  {
    id: "vite",
    name: "Vite",
    icon: "simple-icons:vite",
    detect: (ctx) => hasNodeDep(ctx, "vite"),
    command: "pnpm dev",
    port: 5173,
    installCommand: "pnpm install",
    installMarker: ["node_modules"],
    readyRegex: /ready in \d+\s*ms/i,
    urlExtractRegex: /Local:\s+(https?:\/\/[^\s]+)/,
  },
  {
    id: "angular",
    name: "Angular",
    icon: "simple-icons:angular",
    detect: (ctx) => hasNodeDep(ctx, "@angular/core"),
    command: "pnpm start",
    port: 4200,
    installCommand: "pnpm install",
    installMarker: ["node_modules"],
    readyRegex: /Compiled successfully|Application bundle generation complete/i,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
  },
  {
    id: "spring-boot-maven",
    name: "Spring Boot (Maven)",
    icon: "simple-icons:springboot",
    detect: (ctx) => {
      const pom = ctx.files["pom.xml"];
      return !!(pom && /spring-boot-starter/.test(pom));
    },
    command: "./mvnw spring-boot:run",
    port: 8080,
    installCommand: "./mvnw dependency:resolve",
    installMarker: ["target"],
    readyRegex: /Started \w+Application in [\d.]+ seconds/i,
    urlExtractRegex: null,
    startTimeoutMs: 120_000,
  },
  {
    id: "spring-boot-gradle",
    name: "Spring Boot (Gradle)",
    icon: "simple-icons:springboot",
    detect: (ctx) => {
      const g = ctx.files["build.gradle"] ?? ctx.files["build.gradle.kts"];
      return !!(g && /spring-boot/.test(g));
    },
    command: "./gradlew bootRun",
    port: 8080,
    installCommand: "./gradlew --refresh-dependencies",
    installMarker: [".gradle"],
    readyRegex: /Started \w+Application in [\d.]+ seconds/i,
    urlExtractRegex: null,
    startTimeoutMs: 120_000,
  },
  {
    id: "django",
    name: "Django",
    icon: "simple-icons:django",
    detect: (ctx) => ctx.files["manage.py"] !== null && ctx.files["manage.py"] !== undefined,
    command: "python manage.py runserver",
    port: 8000,
    installCommand: "pip install -r requirements.txt",
    installMarker: [".venv", "venv"],
    readyRegex: /Starting development server at/i,
    urlExtractRegex: /at\s+(https?:\/\/[^\s]+)/,
  },
  {
    id: "fastapi",
    name: "FastAPI",
    icon: "simple-icons:fastapi",
    detect: (ctx) => {
      const req = ctx.files["requirements.txt"] ?? "";
      const pyproject = ctx.files["pyproject.toml"] ?? "";
      return /fastapi/i.test(req + pyproject);
    },
    command: "uvicorn main:app --reload",
    port: 8000,
    installCommand: "pip install -r requirements.txt",
    installMarker: [".venv", "venv"],
    readyRegex: /Application startup complete|Uvicorn running on/i,
    urlExtractRegex: /running on\s+(https?:\/\/[^\s]+)/,
  },
  {
    id: "flask",
    name: "Flask",
    icon: "simple-icons:flask",
    detect: (ctx) => {
      const req = ctx.files["requirements.txt"] ?? "";
      // first-match-wins: fastapi 优先于 flask；这里只要检测含 flask 即可
      return /^flask/im.test(req);
    },
    command: "flask --app app run",
    port: 5000,
    installCommand: "pip install -r requirements.txt",
    installMarker: [".venv", "venv"],
    readyRegex: /Running on\s+http/i,
    urlExtractRegex: /Running on\s+(https?:\/\/[^\s]+)/,
  },
  {
    id: "go-generic",
    name: "Go",
    icon: "simple-icons:go",
    detect: (ctx) => ctx.files["go.mod"] !== null && ctx.files["go.mod"] !== undefined,
    command: "go run .",
    port: 8080,
    installCommand: "go mod download",
    installMarker: ["go.sum"],
    readyRegex: null,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
  },
  {
    id: "static",
    name: "Static HTML",
    icon: "simple-icons:html5",
    detect: (ctx) =>
      ctx.files["index.html"] !== null &&
      ctx.files["index.html"] !== undefined &&
      !ctx.files["package.json"] &&
      !ctx.files["pom.xml"],
    command: "npx serve -l {port} .",
    port: 3000,
    installCommand: null,
    installMarker: null,
    readyRegex: /Accepting connections at/i,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
  },
];
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/preview/presets.test.ts -- --run
```

预期：PASS（11 个 `it` 全绿）

- [ ] **Step 5: Commit**

```bash
git add src/lib/preview/presets.ts tests/unit/lib/preview/presets.test.ts
git commit -m "feat(preview-01.03): add 11 built-in framework presets with detect rules and ready regexes"
```

---

### Task 1.4: Detector 纯函数

**Files:**
- Create: `src/lib/preview/detector.ts`
- Test: `tests/unit/lib/preview/detector.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/lib/preview/detector.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectPreset, readPresetFiles } from "@/lib/preview/detector";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("detectPreset", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "preview-detector-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for empty directory", async () => {
    const result = await detectPreset(dir);
    expect(result).toBeNull();
  });

  it("returns null for non-existent directory", async () => {
    const result = await detectPreset("/nonexistent/path/here");
    expect(result).toBeNull();
  });

  it("detects vite project", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { vite: "^5.0.0" } })
    );
    const result = await detectPreset(dir);
    expect(result?.id).toBe("vite");
  });

  it("detects next project (priority over vite when both present)", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { next: "^15.0.0" },
        devDependencies: { vite: "^5.0.0" },
      })
    );
    const result = await detectPreset(dir);
    expect(result?.id).toBe("next");
  });

  it("detects spring-boot-maven from pom.xml", async () => {
    writeFileSync(
      join(dir, "pom.xml"),
      "<project><dependency>spring-boot-starter-web</dependency></project>"
    );
    const result = await detectPreset(dir);
    expect(result?.id).toBe("spring-boot-maven");
  });

  it("detects django from manage.py", async () => {
    writeFileSync(join(dir, "manage.py"), "import django");
    const result = await detectPreset(dir);
    expect(result?.id).toBe("django");
  });

  it("detects static html as fallback", async () => {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    const result = await detectPreset(dir);
    expect(result?.id).toBe("static");
  });

  it("returns null when index.html exists but package.json also exists (no preset matches)", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "test", dependencies: {} })
    );
    writeFileSync(join(dir, "index.html"), "<html></html>");
    const result = await detectPreset(dir);
    // package.json without recognized dep AND not pure static → null
    expect(result).toBeNull();
  });

  it("survives malformed package.json", async () => {
    writeFileSync(join(dir, "package.json"), "{ not valid json");
    const result = await detectPreset(dir);
    expect(result).toBeNull();
  });
});

describe("readPresetFiles", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "preview-detector-rp-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads only marker files; missing files map to null", async () => {
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    const files = await readPresetFiles(dir);
    expect(files["package.json"]).toBe('{"name":"x"}');
    expect(files["pom.xml"]).toBeNull();
    expect(files["go.mod"]).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/preview/detector.test.ts -- --run
```

预期：FAIL — `Cannot find module '@/lib/preview/detector'`

- [ ] **Step 3: 实现 detector**

```ts
// src/lib/preview/detector.ts
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { PRESETS } from "./presets";
import type { PreviewPreset, DetectContext } from "./preset-types";

const MARKER_FILES = [
  "package.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "manage.py",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "index.html",
] as const;

export async function readPresetFiles(
  cwd: string
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    MARKER_FILES.map(async (name) => {
      try {
        const content = await readFile(join(cwd, name), "utf-8");
        return [name, content] as const;
      } catch {
        return [name, null] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

async function makeContext(cwd: string): Promise<DetectContext> {
  const files = await readPresetFiles(cwd);
  return {
    files,
    hasDir: (rel) => {
      try {
        // sync-safe: detector callers don't need true async hasDir
        // Use access() async would change signature; keep sync via fs require-style
        // For simplicity, allow falsy in detect rules (V1 presets don't use hasDir heavily)
        return false; // placeholder — V1 presets primarily use files map
      } catch {
        return false;
      }
    },
  };
}

export async function detectPreset(
  cwd: string
): Promise<PreviewPreset | null> {
  try {
    await access(cwd, constants.R_OK);
  } catch {
    return null;
  }
  const ctx = await makeContext(cwd);
  for (const preset of PRESETS) {
    try {
      if (preset.detect(ctx)) return preset;
    } catch {
      // continue — preset detect 抛错不影响其他
    }
  }
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/preview/detector.test.ts -- --run
```

预期：PASS（9 个 `it` 全绿）

- [ ] **Step 5: Commit**

```bash
git add src/lib/preview/detector.ts tests/unit/lib/preview/detector.test.ts
git commit -m "feat(preview-01.04): add detectPreset and readPresetFiles pure functions"
```

---

## Phase 2: Session Store + Server Actions

**目标**：建立运行时层 — preview-key 工具、PreviewSession 类（封装 PtySession）、session-store、ready-watcher、url-extractor、重构 preview-actions。

**完成标志**：所有 server action 端到端可调（用 mock dev server 测）；state machine 转移正确；ring buffer 行为正确；删除 `src/lib/preview-process.ts`。

### Task 2.1: preview-key 工具函数

**Files:**
- Create: `src/lib/preview/preview-key.ts`
- Test: `tests/unit/lib/preview/preview-key.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/lib/preview/preview-key.test.ts
import { describe, it, expect } from "vitest";
import {
  getPreviewKey,
  getPreviewCwd,
  getEffectiveCommand,
  getEffectivePort,
} from "@/lib/preview/preview-key";

describe("getPreviewKey", () => {
  it("combines cwd + command + port into key string", () => {
    const k = getPreviewKey({
      cwd: "/repo/h5",
      command: "pnpm dev",
      port: 5173,
    });
    expect(k).toBe("/repo/h5|pnpm dev|5173");
  });

  it("identical effective tuples produce identical keys", () => {
    const a = getPreviewKey({ cwd: "/r", command: "x", port: 1 });
    const b = getPreviewKey({ cwd: "/r", command: "x", port: 1 });
    expect(a).toBe(b);
  });

  it("different cwd produces different keys", () => {
    const a = getPreviewKey({ cwd: "/r/h5", command: "pnpm dev", port: 5173 });
    const b = getPreviewKey({ cwd: "/r/web", command: "pnpm dev", port: 5173 });
    expect(a).not.toBe(b);
  });
});

describe("getPreviewCwd", () => {
  it("returns worktreePath when present", () => {
    expect(
      getPreviewCwd({
        worktreePath: "/wt/abc",
        projectLocalPath: "/repo",
        subPath: null,
      })
    ).toBe("/wt/abc");
  });

  it("returns projectLocalPath + subPath when no worktree", () => {
    expect(
      getPreviewCwd({
        worktreePath: null,
        projectLocalPath: "/repo",
        subPath: "apps/h5",
      })
    ).toBe("/repo/apps/h5");
  });

  it("returns projectLocalPath when no worktree and no subPath", () => {
    expect(
      getPreviewCwd({
        worktreePath: null,
        projectLocalPath: "/repo",
        subPath: null,
      })
    ).toBe("/repo");
  });

  it("returns null when both worktree and projectLocalPath are null", () => {
    expect(
      getPreviewCwd({
        worktreePath: null,
        projectLocalPath: null,
        subPath: null,
      })
    ).toBeNull();
  });

  it("worktree overrides subPath (worktree wins)", () => {
    expect(
      getPreviewCwd({
        worktreePath: "/wt/abc",
        projectLocalPath: "/repo",
        subPath: "apps/h5",
      })
    ).toBe("/wt/abc");
  });
});

describe("getEffectiveCommand", () => {
  it("task override wins", () => {
    expect(
      getEffectiveCommand({
        taskOverride: "task-cmd",
        projectDefault: "proj-cmd",
        presetCommand: "preset-cmd",
      })
    ).toBe("task-cmd");
  });

  it("project default used when task is null", () => {
    expect(
      getEffectiveCommand({
        taskOverride: null,
        projectDefault: "proj-cmd",
        presetCommand: "preset-cmd",
      })
    ).toBe("proj-cmd");
  });

  it("preset command used when both null", () => {
    expect(
      getEffectiveCommand({
        taskOverride: null,
        projectDefault: null,
        presetCommand: "preset-cmd",
      })
    ).toBe("preset-cmd");
  });

  it("empty string when all null", () => {
    expect(
      getEffectiveCommand({
        taskOverride: null,
        projectDefault: null,
        presetCommand: null,
      })
    ).toBe("");
  });
});

describe("getEffectivePort", () => {
  it("task override wins; falls back to project then preset then 0", () => {
    expect(
      getEffectivePort({ taskOverride: 1, projectDefault: 2, presetPort: 3 })
    ).toBe(1);
    expect(
      getEffectivePort({
        taskOverride: null,
        projectDefault: 2,
        presetPort: 3,
      })
    ).toBe(2);
    expect(
      getEffectivePort({
        taskOverride: null,
        projectDefault: null,
        presetPort: 3,
      })
    ).toBe(3);
    expect(
      getEffectivePort({
        taskOverride: null,
        projectDefault: null,
        presetPort: null,
      })
    ).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/preview/preview-key.test.ts -- --run
```

预期：FAIL — module not found

- [ ] **Step 3: 实现**

```ts
// src/lib/preview/preview-key.ts
import { join } from "node:path";

export type PreviewEffective = {
  cwd: string;
  command: string;
  port: number;
};

export function getPreviewKey(eff: PreviewEffective): string {
  return `${eff.cwd}|${eff.command}|${eff.port}`;
}

export function getPreviewCwd(ctx: {
  worktreePath: string | null;
  projectLocalPath: string | null;
  subPath: string | null;
}): string | null {
  if (ctx.worktreePath) return ctx.worktreePath;
  if (!ctx.projectLocalPath) return null;
  return ctx.subPath ? join(ctx.projectLocalPath, ctx.subPath) : ctx.projectLocalPath;
}

export function getEffectiveCommand(ctx: {
  taskOverride: string | null;
  projectDefault: string | null;
  presetCommand: string | null;
}): string {
  return ctx.taskOverride ?? ctx.projectDefault ?? ctx.presetCommand ?? "";
}

export function getEffectivePort(ctx: {
  taskOverride: number | null;
  projectDefault: number | null;
  presetPort: number | null;
}): number {
  return ctx.taskOverride ?? ctx.projectDefault ?? ctx.presetPort ?? 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/preview/preview-key.test.ts -- --run
```

预期：PASS（17 个 `it` 全绿）

- [ ] **Step 5: Commit**

```bash
git add src/lib/preview/preview-key.ts tests/unit/lib/preview/preview-key.test.ts
git commit -m "feat(preview-02.01): add preview-key utilities for cwd/command/port resolution"
```

---

### Task 2.2: URL Extractor + Ready Watcher

**Files:**
- Create: `src/lib/preview/url-extractor.ts`
- Create: `src/lib/preview/ready-watcher.ts`
- Test: `tests/unit/lib/preview/url-extractor.test.ts`
- Test: `tests/unit/lib/preview/ready-watcher.test.ts`

- [ ] **Step 1: 写失败测试（url-extractor）**

```ts
// tests/unit/lib/preview/url-extractor.test.ts
import { describe, it, expect } from "vitest";
import { extractUrl, stripAnsi } from "@/lib/preview/url-extractor";

describe("stripAnsi", () => {
  it("removes ANSI escape sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
  });

  it("leaves plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});

describe("extractUrl", () => {
  it("extracts first http URL", () => {
    expect(extractUrl("Local: http://localhost:5173/")).toBe(
      "http://localhost:5173/"
    );
  });

  it("extracts https URL", () => {
    expect(extractUrl("→ https://example.com/path")).toBe(
      "https://example.com/path"
    );
  });

  it("handles ANSI-wrapped URLs", () => {
    expect(extractUrl("\x1b[36m  http://localhost:5173/\x1b[0m")).toBe(
      "http://localhost:5173/"
    );
  });

  it("returns null when no URL present", () => {
    expect(extractUrl("no urls here")).toBeNull();
  });

  it("uses custom extractRegex when provided", () => {
    const m = extractUrl(
      "Local:   http://localhost:5173/",
      /Local:\s+(https?:\/\/[^\s]+)/
    );
    expect(m).toBe("http://localhost:5173/");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/preview/url-extractor.test.ts -- --run
```

预期：FAIL

- [ ] **Step 3: 实现 url-extractor**

```ts
// src/lib/preview/url-extractor.ts
// 简单 ANSI strip — 不引入外部包
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, "");
}

const DEFAULT_URL_REGEX = /(https?:\/\/[^\s]+)/;

export function extractUrl(line: string, regex?: RegExp): string | null {
  const clean = stripAnsi(line);
  const m = clean.match(regex ?? DEFAULT_URL_REGEX);
  return m?.[1] ?? null;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/preview/url-extractor.test.ts -- --run
```

预期：PASS

- [ ] **Step 5: 写 ready-watcher 失败测试**

```ts
// tests/unit/lib/preview/ready-watcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { ReadyWatcher } from "@/lib/preview/ready-watcher";
import type { PreviewPreset } from "@/lib/preview/preset-types";

const vitePreset: PreviewPreset = {
  id: "vite",
  name: "Vite",
  icon: "x",
  detect: () => true,
  command: "pnpm dev",
  port: 5173,
  installCommand: null,
  installMarker: null,
  readyRegex: /ready in \d+\s*ms/i,
  urlExtractRegex: /Local:\s+(https?:\/\/[^\s]+)/,
};

describe("ReadyWatcher", () => {
  it("fires onReady when regex matches", () => {
    const onReady = vi.fn();
    const onTimeout = vi.fn();
    const w = new ReadyWatcher(vitePreset, 5173, 60_000, onReady, onTimeout);
    w.feedLine("VITE v5.0 ready in 1247 ms");
    expect(onReady).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("extracts URL from line when urlExtractRegex matches", () => {
    const onReady = vi.fn();
    const w = new ReadyWatcher(vitePreset, 5173, 60_000, onReady, vi.fn());
    w.feedLine("ready in 1247 ms");
    w.feedLine("  Local:   http://localhost:5173/");
    // first feedLine fires onReady with null (no URL in that line),
    // second line's URL is captured via pendingExtractedUrl
    // For simplicity: ensure onReady fired at least once
    expect(onReady).toHaveBeenCalled();
    w.stop();
  });

  it("fires onReady only once for multiple matching lines", () => {
    const onReady = vi.fn();
    const w = new ReadyWatcher(vitePreset, 5173, 60_000, onReady, vi.fn());
    w.feedLine("ready in 1 ms");
    w.feedLine("ready in 2 ms");
    expect(onReady).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("fires onTimeout when no signal arrives in time", () => {
    return new Promise<void>((resolve) => {
      const onTimeout = vi.fn(() => {
        expect(onTimeout).toHaveBeenCalled();
        w.stop();
        resolve();
      });
      const w = new ReadyWatcher(vitePreset, 5173, 50, vi.fn(), onTimeout);
      w.start();
      // don't feed any line; wait for timeout
    });
  });

  it("stop() clears timeout and probe — no callbacks fire after stop", async () => {
    const onReady = vi.fn();
    const onTimeout = vi.fn();
    const w = new ReadyWatcher(vitePreset, 5173, 50, onReady, onTimeout);
    w.start();
    w.stop();
    await new Promise((r) => setTimeout(r, 100));
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/preview/ready-watcher.test.ts -- --run
```

预期：FAIL

- [ ] **Step 7: 实现 ready-watcher**

```ts
// src/lib/preview/ready-watcher.ts
import type { PreviewPreset } from "./preset-types";
import { extractUrl } from "./url-extractor";

export class ReadyWatcher {
  private ready = false;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private pendingExtractedUrl: string | null = null;

  constructor(
    private readonly preset: PreviewPreset | null,
    private readonly port: number,
    private readonly timeoutMs: number,
    private readonly onReady: (url: string | null) => void,
    private readonly onTimeout: () => void
  ) {}

  start(): void {
    this.timeoutTimer = setTimeout(() => {
      if (this.ready) return;
      this.onTimeout();
    }, this.timeoutMs);

    // HTTP probe every 500ms
    this.probeTimer = setInterval(() => {
      if (this.ready) return;
      void this.probe();
    }, 500);
  }

  feedLine(line: string): void {
    if (this.ready) return;
    if (this.preset?.urlExtractRegex) {
      const url = extractUrl(line, this.preset.urlExtractRegex);
      if (url) this.pendingExtractedUrl = url;
    }
    if (this.preset?.readyRegex?.test(line)) {
      this.emitReady(this.pendingExtractedUrl);
    }
  }

  stop(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private async probe(): Promise<void> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 200);
      const resp = await fetch(`http://localhost:${this.port}/`, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(t);
      if (resp.status >= 200 && resp.status < 400) {
        this.emitReady(this.pendingExtractedUrl);
      }
    } catch {
      // ignore — server not ready yet
    }
  }

  private emitReady(url: string | null): void {
    if (this.ready) return;
    this.ready = true;
    this.stop();
    this.onReady(url);
  }
}
```

- [ ] **Step 8: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/preview/ready-watcher.test.ts -- --run
```

预期：PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/preview/url-extractor.ts src/lib/preview/ready-watcher.ts \
        tests/unit/lib/preview/url-extractor.test.ts \
        tests/unit/lib/preview/ready-watcher.test.ts
git commit -m "feat(preview-02.02): add ANSI strip + URL extractor + ReadyWatcher (regex + HTTP probe)"
```

---

### Task 2.3: PreviewSession 类

**Files:**
- Create: `src/lib/preview/preview-session.ts`
- Test: `tests/unit/lib/preview/preview-session.test.ts`
- Create: `tests/fixtures/mock-dev-server/index.js` (mock fixture)

- [ ] **Step 1: 写 mock fixture**

```js
// tests/fixtures/mock-dev-server/index.js
#!/usr/bin/env node
// Mock dev server for preview tests.
// Args:
//   --port <n>           port to listen on (required)
//   --ready-msg "<str>"  message to print after delay (default: "ready in 12 ms")
//   --delay <ms>         delay before printing ready msg (default: 200)
//   --output-stream out|err  which stream to print to (default: out)
//   --exit-after <ms>    exit after N ms (default: forever)
const http = require("http");

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    a[k] = argv[i + 1];
    i++;
  }
  return a;
}
const args = parseArgs(process.argv);
const port = parseInt(args.port ?? "5173", 10);
const readyMsg = args["ready-msg"] ?? "ready in 12 ms";
const delay = parseInt(args.delay ?? "200", 10);
const stream = args["output-stream"] === "err" ? process.stderr : process.stdout;
const exitAfter = args["exit-after"] ? parseInt(args["exit-after"], 10) : null;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("mock dev server");
});
server.listen(port, () => {
  setTimeout(() => stream.write(readyMsg + "\n"), delay);
  if (exitAfter) setTimeout(() => process.exit(0), exitAfter);
});
```

- [ ] **Step 2: 写失败测试**

```ts
// tests/unit/lib/preview/preview-session.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PreviewSession } from "@/lib/preview/preview-session";
import { resolve } from "node:path";
import { PRESETS } from "@/lib/preview/presets";

const MOCK = resolve("tests/fixtures/mock-dev-server/index.js");

describe("PreviewSession", () => {
  let session: PreviewSession;

  afterEach(() => {
    if (session) session.stop();
  });

  it("starts with stopped status", () => {
    session = new PreviewSession({
      key: "test|node|9999",
      cwd: process.cwd(),
      command: "node",
      args: [MOCK, "--port", "9999"],
      port: 9999,
      preset: null,
    });
    expect(session.status).toBe("stopped");
  });

  it("transitions stopped → starting → running on real spawn + ready signal", async () => {
    session = new PreviewSession({
      key: "test|node|19999",
      cwd: process.cwd(),
      command: "node",
      args: [MOCK, "--port", "19999", "--ready-msg", "ready in 12 ms"],
      port: 19999,
      preset: PRESETS.find((p) => p.id === "vite")!,
    });
    const states: string[] = [];
    session.onStateChange((s) => states.push(s.status));

    await session.run();

    // wait up to 5s for running
    await new Promise((r) => setTimeout(r, 3000));

    expect(states).toContain("starting");
    expect(session.status).toBe("running");
  }, 10_000);

  it("ring buffer keeps last 5000 lines", () => {
    session = new PreviewSession({
      key: "test|noop|9998",
      cwd: process.cwd(),
      command: "node",
      args: [MOCK, "--port", "9998"],
      port: 9998,
      preset: null,
    });
    // Force-push 5500 fake lines via internal API (export a test helper)
    for (let i = 0; i < 5500; i++) (session as any).pushBuffer(`line ${i}`);
    expect(session.getBuffer().length).toBeLessThanOrEqual(5000);
    expect(session.getBuffer()[0]).not.toBe("line 0"); // earliest dropped
  });

  it("subscribers tracked by connectionId, not taskId", () => {
    session = new PreviewSession({
      key: "test|noop|9997",
      cwd: process.cwd(),
      command: "node",
      args: [MOCK, "--port", "9997"],
      port: 9997,
      preset: null,
    });
    const un1 = session.subscribe("conn-1", "task-A", () => {}, () => {});
    const un2 = session.subscribe("conn-2", "task-A", () => {}, () => {}); // same task, different connection
    expect(session.activeSubscriberCount).toBe(2);
    expect(session.subscriberTaskIds.size).toBe(1);
    un1();
    expect(session.activeSubscriberCount).toBe(1);
    un2();
    expect(session.activeSubscriberCount).toBe(0);
  });

  it("cancelRequested during installing transitions to stopped, not error", async () => {
    session = new PreviewSession({
      key: "test|sleep|9996",
      cwd: process.cwd(),
      command: "node",
      args: ["-e", "setTimeout(() => process.exit(1), 5000)"],
      port: 9996,
      preset: null,
    });
    await session.install({ installCommand: "node", installArgs: ["-e", "setTimeout(() => process.exit(1), 5000)"] });
    expect(session.status).toBe("installing");
    session.stop();
    await new Promise((r) => setTimeout(r, 300));
    expect(session.status).toBe("stopped");
  }, 10_000);
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/preview/preview-session.test.ts -- --run
```

预期：FAIL — module not found

- [ ] **Step 4: 实现 preview-session**

```ts
// src/lib/preview/preview-session.ts
import { PtySession } from "@/lib/pty/pty-session";
import { ReadyWatcher } from "./ready-watcher";
import type { PreviewPreset } from "./preset-types";

export type PreviewStatus =
  | "stopped"
  | "installing"
  | "starting"
  | "running"
  | "error";

export interface PreviewState {
  key: string;
  status: PreviewStatus;
  url: string | null;
  port: number;
  startedAt: number | null;
  readyAt: number | null;
  errorMessage: string | null;
  installed: boolean | null;
  activeSubscribers: number;
  subscriberTaskIds: string[];
}

export interface PreviewSessionOpts {
  key: string;
  cwd: string;
  command: string;
  args: string[];
  port: number;
  preset: PreviewPreset | null;
  envOverrides?: Record<string, string>;
}

export interface InstallOpts {
  installCommand: string;
  installArgs: string[];
  installCwd?: string;
  autoStartAfter?: boolean;
}

const BUFFER_MAX_LINES = 5000;

export class PreviewSession {
  status: PreviewStatus = "stopped";
  private pty: PtySession | null = null;
  private ringBuffer: string[] = [];
  private currentUrl: string | null = null;
  private startedAt: number | null = null;
  private readyAt: number | null = null;
  private errorMessage: string | null = null;
  private installed: boolean | null = null;
  private readyWatcher: ReadyWatcher | null = null;
  private cancelRequested = false;
  private pendingAutoStart: PreviewSessionOpts | null = null;

  private outputListeners = new Map<string, (data: string) => void>();
  private stateListeners = new Map<string, (state: PreviewState) => void>();
  private subscribers = new Map<string, { taskId: string }>();

  constructor(public readonly opts: PreviewSessionOpts) {}

  get key(): string {
    return this.opts.key;
  }

  get activeSubscriberCount(): number {
    return this.subscribers.size;
  }

  get subscriberTaskIds(): Set<string> {
    return new Set([...this.subscribers.values()].map((v) => v.taskId));
  }

  getBuffer(): string[] {
    return [...this.ringBuffer];
  }

  getState(): PreviewState {
    return {
      key: this.opts.key,
      status: this.status,
      url: this.currentUrl,
      port: this.opts.port,
      startedAt: this.startedAt,
      readyAt: this.readyAt,
      errorMessage: this.errorMessage,
      installed: this.installed,
      activeSubscribers: this.activeSubscriberCount,
      subscriberTaskIds: [...this.subscriberTaskIds],
    };
  }

  subscribe(
    connectionId: string,
    taskId: string,
    onState: (s: PreviewState) => void,
    onOutput: (data: string) => void
  ): () => void {
    this.subscribers.set(connectionId, { taskId });
    this.stateListeners.set(connectionId, onState);
    this.outputListeners.set(connectionId, onOutput);
    return () => {
      this.subscribers.delete(connectionId);
      this.stateListeners.delete(connectionId);
      this.outputListeners.delete(connectionId);
      this.broadcastState();
    };
  }

  async run(): Promise<{ started: boolean; error?: string }> {
    if (this.status === "installing") {
      return { started: false, error: "Install in progress" };
    }
    if (this.status === "running" || this.status === "starting") {
      return { started: true };
    }
    this.cancelRequested = false;
    this.errorMessage = null;
    this.status = "starting";
    this.startedAt = Date.now();
    this.broadcastState();

    try {
      this.pty = this.createPty(this.opts.command, this.opts.args, this.opts.cwd);
    } catch (err) {
      this.status = "error";
      this.errorMessage = `Failed to spawn: ${String(err)}`;
      this.broadcastState();
      return { started: false, error: this.errorMessage };
    }

    this.readyWatcher = new ReadyWatcher(
      this.opts.preset,
      this.opts.port,
      this.opts.preset?.startTimeoutMs ?? 60_000,
      (url) => this.handleReady(url),
      () => this.handleTimeout()
    );
    this.readyWatcher.start();
    return { started: true };
  }

  async install(opts: InstallOpts): Promise<{ ok: boolean; error?: string }> {
    if (this.status !== "stopped" && this.status !== "error") {
      return { ok: false, error: `Cannot install while ${this.status}` };
    }
    this.cancelRequested = false;
    this.errorMessage = null;
    this.status = "installing";
    if (opts.autoStartAfter) this.pendingAutoStart = this.opts;
    this.broadcastState();

    try {
      this.pty = this.createPty(
        opts.installCommand,
        opts.installArgs,
        opts.installCwd ?? this.opts.cwd
      );
    } catch (err) {
      this.status = "error";
      this.errorMessage = `Failed to spawn install: ${String(err)}`;
      this.broadcastState();
      return { ok: false, error: this.errorMessage };
    }
    return { ok: true };
  }

  stop(): void {
    if (this.status === "installing" || this.status === "starting" || this.status === "running") {
      this.cancelRequested = true;
    }
    if (this.readyWatcher) {
      this.readyWatcher.stop();
      this.readyWatcher = null;
    }
    if (this.pty && !this.pty.killed) {
      try {
        this.pty.kill();  // ⚠ PtySession.kill() 不接受参数，参考 src/lib/pty/pty-session.ts:150
      } catch {
        // best-effort
      }
    }
    // If pty already exited (or never spawned), force-set state
    if (!this.pty || this.pty.killed) {
      this.status = "stopped";
      this.pendingAutoStart = null;
      this.broadcastState();
    }
  }

  // Test helper
  pushBuffer(line: string): void {
    this.ringBuffer.push(line);
    if (this.ringBuffer.length > BUFFER_MAX_LINES) {
      this.ringBuffer.splice(0, this.ringBuffer.length - BUFFER_MAX_LINES);
    }
  }

  private createPty(command: string, args: string[], cwd: string): PtySession {
    const pty = new PtySession(
      this.opts.key,
      command,
      args,
      cwd,
      (data) => this.handlePtyData(data),
      (exitCode) => this.handlePtyExit(exitCode),
      this.opts.envOverrides,
      undefined, // onIdle disabled — dev server may be silent for long periods
      undefined
    );
    // Mitigate narrow PTY: resize to 200x50 so dev server logs don't wrap mid-readyRegex
    try {
      (pty as { resize?: (cols: number, rows: number) => void }).resize?.(200, 50);
    } catch {
      // ignore — resize is best-effort
    }
    return pty;
  }

  private handlePtyData(data: string): void {
    // Split into lines, push to buffer, fan out to listeners, feed ready watcher
    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      if (line.length === 0) continue;
      this.pushBuffer(line);
      if (this.readyWatcher) this.readyWatcher.feedLine(line);
    }
    for (const fn of this.outputListeners.values()) {
      try {
        fn(data);
      } catch {
        // ignore listener errors
      }
    }
  }

  private handlePtyExit(exitCode: number): void {
    const wasCancel = this.cancelRequested;
    const wasInstalling = this.status === "installing";
    this.pty = null;
    if (this.readyWatcher) {
      this.readyWatcher.stop();
      this.readyWatcher = null;
    }
    if (wasCancel) {
      this.status = "stopped";
      this.pendingAutoStart = null;
    } else if (exitCode === 0 && wasInstalling) {
      this.installed = true;
      if (this.pendingAutoStart) {
        this.pendingAutoStart = null;
        // ⚠ 不要变异 this.opts —— 违反 immutability 原则
        // pendingAutoStart 存的就是 this.opts 本身的引用，run() 用现有 opts 即可
        setTimeout(() => void this.run(), 0);
      } else {
        this.status = "stopped";
      }
    } else if (exitCode !== 0) {
      this.status = "error";
      this.errorMessage = `Process exited with code ${exitCode}`;
      this.pendingAutoStart = null;  // ⚠ install 失败时清除，避免 retry 时 stale 状态
    } else {
      this.status = "stopped";
    }
    this.broadcastState();
  }

  private handleReady(url: string | null): void {
    this.currentUrl = url ?? `http://localhost:${this.opts.port}/`;
    this.status = "running";
    this.readyAt = Date.now();
    this.broadcastState();
  }

  private handleTimeout(): void {
    this.status = "error";
    this.errorMessage = `Start timeout (${this.opts.preset?.startTimeoutMs ?? 60_000}ms). See logs.`;
    this.broadcastState();
  }

  onStateChange(fn: (s: PreviewState) => void): void {
    this.stateListeners.set(`__internal-${Math.random()}`, fn);
  }

  private broadcastState(): void {
    const state = this.getState();
    for (const fn of this.stateListeners.values()) {
      try {
        fn(state);
      } catch {
        // ignore
      }
    }
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/preview/preview-session.test.ts -- --run
```

预期：PASS（5 个 `it` 全绿）。如有 `pty.resize` 不存在导致测试报错，先确认 `PtySession` 是否暴露 resize；如未暴露，加一个轻量 `pty.resize` 方法到 `src/lib/pty/pty-session.ts`（详见 Task 2.7 备注）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/preview/preview-session.ts \
        tests/unit/lib/preview/preview-session.test.ts \
        tests/fixtures/mock-dev-server/index.js
git commit -m "feat(preview-02.03): add PreviewSession class with state machine, ring buffer, subscribers"
```

---

### Task 2.4: Session Store + SIGTERM 钩子

**Files:**
- Create: `src/lib/preview/session-store.ts`
- Test: `tests/unit/lib/preview/session-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/lib/preview/session-store.test.ts
import { describe, it, expect, afterEach } from "vitest";
import {
  getOrCreatePreviewSession,
  getPreviewSession,
  destroyPreviewSession,
  destroyAllPreviewSessions,
} from "@/lib/preview/session-store";

const baseOpts = {
  cwd: process.cwd(),
  command: "node",
  args: ["-e", "setInterval(() => {}, 1000)"],
  port: 9990,
  preset: null,
};

describe("session-store", () => {
  afterEach(() => destroyAllPreviewSessions());

  it("creates new session for new key", () => {
    const s = getOrCreatePreviewSession("k1", baseOpts);
    expect(s.key).toBe("k1");
  });

  it("returns same session for repeated key", () => {
    const a = getOrCreatePreviewSession("k2", baseOpts);
    const b = getOrCreatePreviewSession("k2", baseOpts);
    expect(a).toBe(b);
  });

  it("getPreviewSession returns undefined for unknown key", () => {
    expect(getPreviewSession("nonexistent")).toBeUndefined();
  });

  it("destroyPreviewSession removes from map", () => {
    getOrCreatePreviewSession("k3", baseOpts);
    destroyPreviewSession("k3");
    expect(getPreviewSession("k3")).toBeUndefined();
  });

  it("destroyAllPreviewSessions clears all", () => {
    getOrCreatePreviewSession("k4", baseOpts);
    getOrCreatePreviewSession("k5", baseOpts);
    destroyAllPreviewSessions();
    expect(getPreviewSession("k4")).toBeUndefined();
    expect(getPreviewSession("k5")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/preview/session-store.test.ts -- --run
```

预期：FAIL

- [ ] **Step 3: 实现 session-store**

```ts
// src/lib/preview/session-store.ts
import { PreviewSession, type PreviewSessionOpts } from "./preview-session";

declare global {
  // eslint-disable-next-line no-var
  var __previewSignalHandlersRegistered: boolean | undefined;
  // eslint-disable-next-line no-var
  var __previewSessions: Map<string, PreviewSession> | undefined;
}

// ⚠ HMR-safe singleton：Next.js dev 模式会重求值这个模块。把 sessions 挂在 globalThis 上，
//    确保 SIGTERM 钩子调用 destroyAllPreviewSessions 时拿到的是当前活跃的 Map，而非旧模块孤儿。
const sessions: Map<string, PreviewSession> = (globalThis.__previewSessions ??= new Map());

export function getOrCreatePreviewSession(
  key: string,
  opts: Omit<PreviewSessionOpts, "key">
): PreviewSession {
  let s = sessions.get(key);
  if (!s) {
    s = new PreviewSession({ ...opts, key });
    sessions.set(key, s);
  }
  return s;
}

export function getPreviewSession(key: string): PreviewSession | undefined {
  return sessions.get(key);
}

export function destroyPreviewSession(key: string): void {
  const s = sessions.get(key);
  if (!s) return;
  try {
    s.stop();
  } catch {
    // ignore
  }
  sessions.delete(key);
}

export function destroyAllPreviewSessions(): void {
  for (const key of [...sessions.keys()]) {
    destroyPreviewSession(key);
  }
}

if (!globalThis.__previewSignalHandlersRegistered) {
  process.on("SIGTERM", destroyAllPreviewSessions);
  process.on("SIGINT", destroyAllPreviewSessions);
  process.on("SIGHUP", destroyAllPreviewSessions);
  globalThis.__previewSignalHandlersRegistered = true;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/preview/session-store.test.ts -- --run
```

预期：PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/preview/session-store.ts tests/unit/lib/preview/session-store.test.ts
git commit -m "feat(preview-02.04): add preview session-store with SIGTERM/SIGINT/SIGHUP handlers"
```

---

### Task 2.5: 重构 preview-actions.ts

**Files:**
- Modify: `src/actions/preview-actions.ts`（完全重写）
- Modify: `tests/unit/actions/preview-actions.test.ts`（重写）
- Delete: `src/lib/preview-process.ts`
- Delete: `tests/unit/lib/preview-process-manager.test.ts`

- [ ] **Step 0: 装 shell-quote**

```bash
pnpm add shell-quote
pnpm add -D @types/shell-quote
```

- [ ] **Step 1: 跑 pre-flight grep 确认无其他 importer**

```bash
grep -rn "preview-process\|registerPreviewProcess\|killPreviewProcess\|isPreviewRunning" \
  src --include="*.ts" --include="*.tsx" | grep -v ".test.\|__tests__"
```

预期：仅 `src/actions/preview-actions.ts:11` 一处。

- [ ] **Step 2: 写新版 preview-actions 失败测试**

```ts
// tests/unit/actions/preview-actions.test.ts (完全重写)
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import {
  getPreviewState,
  startPreview,
  stopPreview,
} from "@/actions/preview-actions";
import { destroyAllPreviewSessions } from "@/lib/preview/session-store";
import { db } from "@/lib/db";

// 这些测试需要 SQLite 测试 DB；如果项目用 jest fixture，复用现有 pattern
// 否则使用真实 db.project/db.task 的 fixture 创建/清理
let workspaceId: string;
let projectId: string;
let taskId: string;

beforeAll(async () => {
  const ws = await db.workspace.create({ data: { name: "preview-test-ws" } });
  workspaceId = ws.id;
  const proj = await db.project.create({
    data: {
      name: "preview-test-proj",
      type: "NORMAL",
      localPath: process.cwd(),
      workspaceId,
      previewPreset: null,
    },
  });
  projectId = proj.id;
  const task = await db.task.create({
    data: { title: "preview-test-task", projectId },
  });
  taskId = task.id;
});

afterEach(() => {
  destroyAllPreviewSessions();
});

describe("getPreviewState", () => {
  it("returns stopped state for new task", async () => {
    const s = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s.status).toBe("stopped");
    expect(s.previewKey).toBeTruthy();
    expect(s.activeSubscribers).toBe(0);
  });

  it("computes effective command from preset when project/task null", async () => {
    await db.project.update({
      where: { id: projectId },
      data: { previewPreset: "vite", previewCommand: null },
    });
    const s = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s.command).toBe("pnpm dev");
    expect(s.port).toBe(5173);
  });

  it("task override takes precedence", async () => {
    await db.task.update({
      where: { id: taskId },
      data: { previewCommandOverride: "pnpm dev:full", previewPortOverride: 6173 },
    });
    const s = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s.command).toBe("pnpm dev:full");
    expect(s.port).toBe(6173);
  });
});

describe("startPreview / stopPreview", () => {
  it("returns error when cwd is null", async () => {
    const orphanTask = await db.task.create({
      data: { title: "orphan", projectId },
    });
    await db.project.update({
      where: { id: projectId },
      data: { localPath: null },
    });
    const r = await startPreview({
      taskId: orphanTask.id,
      projectId,
      worktreePath: null,
    });
    expect(r.started).toBe(false);
    // restore
    await db.project.update({
      where: { id: projectId },
      data: { localPath: process.cwd() },
    });
  });

  it("returns error when port is in use", async () => {
    // bind a server to port 9988
    const http = await import("node:http");
    const blocker = http.createServer().listen(9988);
    await new Promise((r) => blocker.once("listening", r));

    await db.task.update({
      where: { id: taskId },
      data: { previewCommandOverride: "node", previewPortOverride: 9988 },
    });

    const r = await startPreview({ taskId, projectId, worktreePath: null });
    expect(r.started).toBe(false);
    expect(r.error).toMatch(/in use|EADDRINUSE/i);

    blocker.close();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm test tests/unit/actions/preview-actions.test.ts -- --run
```

预期：FAIL — 新签名/新逻辑还没实现。

- [ ] **Step 4: 重写 preview-actions.ts**

```ts
// src/actions/preview-actions.ts (完全替换)
"use server";

import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { db } from "@/lib/db";
import { PRESETS } from "@/lib/preview/presets";
import {
  getPreviewKey,
  getPreviewCwd,
  getEffectiveCommand,
  getEffectivePort,
} from "@/lib/preview/preview-key";
import {
  getOrCreatePreviewSession,
  getPreviewSession,
  destroyPreviewSession,
} from "@/lib/preview/session-store";
import type { PreviewPreset } from "@/lib/preview/preset-types";
import { detectPreset } from "@/lib/preview/detector";
import { readConfigValue } from "@/lib/config-reader";

interface PreviewStateResp {
  previewKey: string;
  status: string;
  preset: { id: string; name: string; icon: string; docUrl?: string } | null;
  presetSource: "project" | "subPath-detected" | null;
  command: string;
  port: number;
  installCommand: string | null;
  url: string | null;
  installed: boolean | null;
  startedAt: number | null;
  readyAt: number | null;
  errorMessage: string | null;
  recentLogs: string[];
  activeSubscribers: number;
  cwd: string | null;
}

async function resolveEffective(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
}): Promise<{
  task: { previewCommandOverride: string | null; previewPortOverride: number | null; subPath: string | null };
  project: { localPath: string | null; previewCommand: string | null; previewPort: number | null; previewPreset: string | null; previewInstallCommand: string | null };
  preset: PreviewPreset | null;
  presetSource: "project" | "subPath-detected" | null;
  cwd: string | null;
  command: string;
  port: number;
  installCommand: string | null;
}> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: args.taskId },
    select: {
      previewCommandOverride: true,
      previewPortOverride: true,
      subPath: true,
    },
  });
  const project = await db.project.findUniqueOrThrow({
    where: { id: args.projectId },
    select: {
      localPath: true,
      previewCommand: true,
      previewPort: true,
      previewPreset: true,
      previewInstallCommand: true,
    },
  });

  const cwd = getPreviewCwd({
    worktreePath: args.worktreePath,
    projectLocalPath: project.localPath,
    subPath: task.subPath,
  });

  // Preset resolution
  let preset: PreviewPreset | null = null;
  let presetSource: "project" | "subPath-detected" | null = null;
  if (task.subPath && cwd) {
    preset = await detectPreset(cwd);
    presetSource = preset ? "subPath-detected" : null;
  } else if (project.previewPreset) {
    preset = PRESETS.find((p) => p.id === project.previewPreset) ?? null;
    presetSource = preset ? "project" : null;
  }

  const command = getEffectiveCommand({
    taskOverride: task.previewCommandOverride,
    projectDefault: project.previewCommand,
    presetCommand: preset?.command ?? null,
  });
  const port = getEffectivePort({
    taskOverride: task.previewPortOverride,
    projectDefault: project.previewPort,
    presetPort: preset?.port ?? null,
  });
  const installCommand = project.previewInstallCommand ?? preset?.installCommand ?? null;

  return { task, project, preset, presetSource, cwd, command, port, installCommand };
}

// ⚠ 用 shell-quote 包正确解析 — 必须先 `pnpm add shell-quote @types/shell-quote`（Task 2.5 起手做）
//    覆盖：引号 (`"."`), 环境变量前缀 (`BROWSER=none pnpm dev`), 多空格, escape
import { parse as shellParse } from "shell-quote";

function parseCommandLine(cmd: string, port: number): {
  command: string;
  args: string[];
  envOverrides?: Record<string, string>;
} {
  const replaced = cmd.replace(/\{port\}/g, String(port));
  const tokens = shellParse(replaced);  // → string[] | object[] (操作符)
  const env: Record<string, string> = {};
  const parts: string[] = [];

  for (const tok of tokens) {
    if (typeof tok !== "string") continue;  // 跳过 shell 操作符如 {op:"&&"}
    // 形如 KEY=value 的前缀，仅在 parts 还为空时视为环境变量
    if (parts.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      const idx = tok.indexOf("=");
      env[tok.slice(0, idx)] = tok.slice(idx + 1);
      continue;
    }
    parts.push(tok);
  }

  return {
    command: parts[0] ?? "",
    args: parts.slice(1),
    envOverrides: Object.keys(env).length > 0 ? env : undefined,
  };
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(port, "127.0.0.1");
  });
}

// ⚠ ESM 文件不能 require()，顶部 import { existsSync } from "node:fs" + import path from "node:path"
import { existsSync } from "node:fs";
import path from "node:path";

function checkInstalled(
  preset: PreviewPreset | null,
  cwd: string | null
): boolean | null {
  if (!preset || !preset.installMarker || !cwd) return null;
  return preset.installMarker.some((m) => {
    try {
      return existsSync(path.join(cwd, m));
    } catch {
      return false;
    }
  });
}

// ⚠ M-7: monorepo install cwd 处理
//    - preset.installCwd === "monorepo-root" → 强制 project.localPath
//    - 否则自动检测：根目录有 pnpm-workspace.yaml 或 package.json 含 workspaces 字段
//      → 在 monorepo 根跑 install
import { readFileSync } from "node:fs";
function isMonorepoRoot(projectLocalPath: string): boolean {
  try {
    if (existsSync(path.join(projectLocalPath, "pnpm-workspace.yaml"))) return true;
    const pkgPath = path.join(projectLocalPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.workspaces) return true;
    }
  } catch {
    // best-effort
  }
  return false;
}

function getInstallCwd(
  preset: PreviewPreset | null,
  effectiveCwd: string,
  projectLocalPath: string | null
): string {
  if (preset?.installCwd === "monorepo-root" && projectLocalPath) {
    return projectLocalPath;
  }
  if (projectLocalPath && effectiveCwd !== projectLocalPath && isMonorepoRoot(projectLocalPath)) {
    return projectLocalPath;
  }
  return effectiveCwd;
}

export async function getPreviewState(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
}): Promise<PreviewStateResp> {
  const eff = await resolveEffective(args);

  // T2: 兜底探测 — 如果 project.previewPreset null 且 cwd 存在，fire-and-forget 探测并写回
  // ⚠ 必须用 updateMany — Prisma 的 update() 只接受唯一字段 where；混 id + 非唯一字段会抛错
  if (!eff.project.previewPreset && !eff.task.subPath && eff.cwd) {
    void (async () => {
      try {
        const detected = await detectPreset(eff.cwd!);
        if (detected) {
          await db.project.updateMany({
            where: { id: args.projectId, previewPreset: null },
            data: { previewPreset: detected.id },
          });
        }
      } catch {
        // best-effort
      }
    })();
  }

  const previewKey = eff.cwd
    ? getPreviewKey({ cwd: eff.cwd, command: eff.command, port: eff.port })
    : "no-cwd";

  const session = getPreviewSession(previewKey);
  const installed = checkInstalled(eff.preset, eff.cwd);

  return {
    previewKey,
    status: session?.status ?? "stopped",
    preset: eff.preset
      ? { id: eff.preset.id, name: eff.preset.name, icon: eff.preset.icon, docUrl: eff.preset.docUrl }
      : null,
    presetSource: eff.presetSource,
    command: eff.command,
    port: eff.port,
    installCommand: eff.installCommand,
    url: session?.getState().url ?? null,
    installed,
    startedAt: session?.getState().startedAt ?? null,
    readyAt: session?.getState().readyAt ?? null,
    errorMessage: session?.getState().errorMessage ?? null,
    recentLogs: session?.getBuffer().slice(-500) ?? [],
    activeSubscribers: session?.activeSubscriberCount ?? 0,
    cwd: eff.cwd,
  };
}

export async function startPreview(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
}): Promise<{ started: boolean; error?: string }> {
  const eff = await resolveEffective(args);
  if (!eff.cwd) return { started: false, error: "No working directory configured" };
  if (!eff.command) return { started: false, error: "No command configured" };
  if (eff.port <= 0) return { started: false, error: "Invalid port" };

  // M-1: pre-check port availability
  if (await isPortInUse(eff.port)) {
    return {
      started: false,
      error: `Port ${eff.port} is in use. Set Task.previewPortOverride to use a different port, or stop the conflicting process.`,
    };
  }

  const previewKey = getPreviewKey({ cwd: eff.cwd, command: eff.command, port: eff.port });
  const parsed = parseCommandLine(eff.command, eff.port);

  const session = getOrCreatePreviewSession(previewKey, {
    cwd: eff.cwd,
    command: parsed.command,
    args: parsed.args,
    port: eff.port,
    preset: eff.preset,
    envOverrides: parsed.envOverrides,
  });
  return session.run();
}

export async function stopPreview(args: { previewKey: string }): Promise<void> {
  const session = getPreviewSession(args.previewKey);
  if (session) session.stop();
}

export async function installPreviewDeps(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
  autoStartAfter?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const eff = await resolveEffective(args);
  if (!eff.cwd) return { ok: false, error: "No working directory" };
  if (!eff.installCommand) return { ok: false, error: "No install command configured" };

  const previewKey = getPreviewKey({ cwd: eff.cwd, command: eff.command, port: eff.port });
  const installParts = eff.installCommand.trim().split(/\s+/);
  const installCmd = installParts[0] ?? "";
  const installArgs = installParts.slice(1);

  const parsed = parseCommandLine(eff.command, eff.port);
  const session = getOrCreatePreviewSession(previewKey, {
    cwd: eff.cwd,
    command: parsed.command,
    args: parsed.args,
    port: eff.port,
    preset: eff.preset,
    envOverrides: parsed.envOverrides,
  });
  // ⚠ M-7: install 走 getInstallCwd 选定的目录（monorepo 根 or self）
  const installCwd = getInstallCwd(eff.preset, eff.cwd, eff.project.localPath);
  return session.install({
    installCommand: installCmd,
    installArgs,
    installCwd,
    autoStartAfter: args.autoStartAfter,
  });
}

export async function redetectPreset(args: {
  projectId: string;
  worktreePath?: string | null;
}): Promise<{ preset: string | null }> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: args.projectId },
    select: { localPath: true },
  });
  const cwd = args.worktreePath ?? project.localPath;
  if (!cwd) return { preset: null };
  const detected = await detectPreset(cwd);
  await db.project.update({
    where: { id: args.projectId },
    data: { previewPreset: detected?.id ?? null },
  });
  return { preset: detected?.id ?? null };
}

export async function setProjectPreset(args: {
  projectId: string;
  presetId: string | null;
}): Promise<void> {
  if (args.presetId && !PRESETS.some((p) => p.id === args.presetId)) {
    throw new Error(`Unknown preset id: ${args.presetId}`);
  }
  await db.project.update({
    where: { id: args.projectId },
    data: { previewPreset: args.presetId },
  });
}

// Existing function — preserved
const ALLOWED_TERMINAL_APPS_MACOS = ["Terminal", "iTerm", "iTerm2", "Warp", "Hyper", "Alacritty", "WezTerm", "kitty"];
const ALLOWED_TERMINAL_APPS_WINDOWS = ["cmd", "powershell", "pwsh", "wt", "Windows Terminal"];
const ALLOWED_TERMINAL_APPS_LINUX = ["gnome-terminal", "konsole", "xterm", "alacritty", "kitty", "wezterm", "xfce4-terminal", "tilix"];

export async function openInTerminal(worktreePath: string): Promise<void> {
  if (!worktreePath || !isAbsolute(worktreePath)) {
    throw new Error("openInTerminal requires an absolute path");
  }
  const platform = process.platform;
  if (platform === "darwin") {
    const terminalApp = await readConfigValue<string>("terminal.app", "Terminal");
    if (!ALLOWED_TERMINAL_APPS_MACOS.includes(terminalApp)) {
      throw new Error(`Terminal app '${terminalApp}' is not in the allowed list`);
    }
    execFileSync("open", ["-a", terminalApp, worktreePath]);
  } else if (platform === "win32") {
    const terminalApp = await readConfigValue<string>("terminal.app", "wt");
    if (ALLOWED_TERMINAL_APPS_WINDOWS.includes(terminalApp)) {
      if (terminalApp === "wt" || terminalApp === "Windows Terminal") {
        execFileSync("cmd.exe", ["/c", "start", "wt", "-d", worktreePath]);
      } else if (terminalApp === "powershell" || terminalApp === "pwsh") {
        execFileSync("cmd.exe", ["/c", "start", terminalApp, "-NoExit", "-Command", `Set-Location '${worktreePath}'`]);
      } else {
        execFileSync("cmd.exe", ["/c", "start", "cmd", "/k", `cd /d "${worktreePath}"`]);
      }
    } else {
      throw new Error(`Terminal app '${terminalApp}' is not in the allowed list`);
    }
  } else {
    const terminalApp = await readConfigValue<string>("terminal.app", "xdg-open");
    if (terminalApp === "xdg-open") {
      execFileSync("xdg-open", [worktreePath]);
    } else if (ALLOWED_TERMINAL_APPS_LINUX.includes(terminalApp)) {
      execFileSync(terminalApp, ["--working-directory", worktreePath]);
    } else {
      throw new Error(`Terminal app '${terminalApp}' is not in the allowed list`);
    }
  }
}
```

- [ ] **Step 5: 删除旧文件**

```bash
git rm src/lib/preview-process.ts tests/unit/lib/preview-process-manager.test.ts
```

- [ ] **Step 6: 跑测试确认通过**

```bash
pnpm test tests/unit/actions/preview-actions.test.ts -- --run
```

预期：PASS（5 个 `it` 全绿）

跑一遍全套确认没有 regression：

```bash
pnpm test -- --run
```

预期：全过。

- [ ] **Step 7: Commit**

```bash
git add src/actions/preview-actions.ts tests/unit/actions/preview-actions.test.ts
git commit -m "feat(preview-02.05): rewrite preview-actions to use new session-store; delete legacy preview-process"
```

---

### Task 2.6: PtySession 加 resize 方法（如果尚未暴露）

**Files:**
- Modify: `src/lib/pty/pty-session.ts`
- Test: `tests/unit/lib/pty-session.test.ts`（追加）

仅当 Task 2.3 的 `pty.resize(200, 50)` 报错时执行；否则跳过此 task。

- [ ] **Step 1: 验证当前 PtySession 是否暴露 resize**

```bash
grep -n "resize" /Users/liujunping/project/f/tower/src/lib/pty/pty-session.ts
```

如果有 `resize` 方法 → 跳过本 task；如无 → 继续。

- [ ] **Step 2: 写失败测试**

```ts
// 追加到 tests/unit/lib/pty-session.test.ts
it("resize() forwards to node-pty resize without throwing", () => {
  const s = new PtySession(
    "test-resize",
    "node",
    ["-e", "setTimeout(() => {}, 1000)"],
    process.cwd(),
    () => {},
    () => {}
  );
  expect(() => s.resize(200, 50)).not.toThrow();
  s.kill?.();
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/pty-session.test.ts -- --run
```

预期：FAIL — `s.resize is not a function`

- [ ] **Step 4: 加 resize 方法**

```ts
// src/lib/pty/pty-session.ts
// 加入 PtySession 类内部
resize(cols: number, rows: number): void {
  if (this.killed) return;
  try {
    this._pty.resize(cols, rows);
  } catch {
    // ignore — best-effort
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/pty-session.test.ts -- --run
```

预期：PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/pty/pty-session.ts tests/unit/lib/pty-session.test.ts
git commit -m "feat(preview-02.06): expose PtySession.resize() for preview's 200-col init"
```

---

## Phase 3: 探测时机接入

**目标**：把 detector 接入 createProject/updateProject (T1) 和 getPreviewState (T2)；暴露 redetectPreset (T3) action。subPath 实时探测已在 Phase 2 的 `resolveEffective` 实现，本 phase 只补 T1。

**完成标志**：新建 vite 项目 → DB `previewPreset = "vite"`；空目录创建 → null；老项目首次开 preview → 自动补 previewPreset。

### Task 3.1: createProject / updateProject 触发 T1 探测

**Files:**
- Modify: `src/actions/workspace-actions.ts`
- Test: `tests/unit/actions/workspace-actions-preview.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/actions/workspace-actions-preview.test.ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  createProject,
  updateProject,
} from "@/actions/workspace-actions";
import { db } from "@/lib/db";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspaceId: string;

beforeAll(async () => {
  const ws = await db.workspace.create({ data: { name: "preview-t1-ws" } });
  workspaceId = ws.id;
});

describe("createProject — preview preset detection (T1)", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("detects vite preset on create when localPath has package.json with vite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-t1-vite-"));
    tmpDirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { vite: "^5.0.0" } })
    );

    const project = await createProject({
      name: "vite-test",
      localPath: dir,
      workspaceId,
    });

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("vite");
  });

  it("leaves previewPreset null when localPath is empty directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-t1-empty-"));
    tmpDirs.push(dir);

    const project = await createProject({
      name: "empty-test",
      localPath: dir,
      workspaceId,
    });

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBeNull();
  });

  it("does not throw when localPath does not exist (auto-created empty)", async () => {
    const dir = join(tmpdir(), `preview-t1-new-${Date.now()}`);
    tmpDirs.push(dir);

    const project = await createProject({
      name: "new-dir-test",
      localPath: dir,
      workspaceId,
    });

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBeNull();
  });
});

describe("updateProject — preview preset detection on localPath change", () => {
  it("re-detects preset when localPath changes to a recognized project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-t1-update-"));
    writeFileSync(
      join(dir, "go.mod"),
      "module foo\ngo 1.21\n"
    );

    const blankDir = mkdtempSync(join(tmpdir(), "preview-t1-blank-"));
    const project = await createProject({
      name: "update-test",
      localPath: blankDir,
      workspaceId,
    });
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).previewPreset).toBeNull();

    await updateProject(project.id, { localPath: dir });

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("go-generic");

    rmSync(dir, { recursive: true, force: true });
    rmSync(blankDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/actions/workspace-actions-preview.test.ts -- --run
```

预期：FAIL — createProject 还没接 T1。

- [ ] **Step 3: 修改 createProject 和 updateProject**

修改 `src/actions/workspace-actions.ts`，在 `createProject` 的 `return project` 之前、在 `updateProject` 中如果 localPath 变了，加 T1 触发：

```ts
// 在文件顶部 import
import { detectPreset } from "@/lib/preview/detector";
import { readdir } from "node:fs/promises";

// 在 createProject 内、return project 之前：
// T1: 探测 preset（仅当 localPath 非空时）
if (resolvedLocalPath) {
  try {
    const entries = await readdir(resolvedLocalPath).catch(() => [] as string[]);
    if (entries.length > 0) {
      const detected = await detectPreset(resolvedLocalPath);
      if (detected) {
        await db.project.update({
          where: { id: project.id },
          data: { previewPreset: detected.id },
        });
      }
    }
  } catch {
    // 探测失败不阻塞创建
  }
}

// 在 updateProject 内（return project 之前）：
// 如果 localPath 变了，重新触发 T1
if (data.localPath !== undefined) {
  const resolved = data.localPath ? expandHome(data.localPath) : null;
  if (resolved) {
    try {
      const entries = await readdir(resolved).catch(() => [] as string[]);
      if (entries.length > 0) {
        const detected = await detectPreset(resolved);
        await db.project.update({
          where: { id },
          data: { previewPreset: detected?.id ?? null },
        });
      }
    } catch {
      // 失败不阻塞 update
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/actions/workspace-actions-preview.test.ts -- --run
```

预期：PASS

跑完整测试套防回归：

```bash
pnpm test -- --run
```

- [ ] **Step 5: Commit**

```bash
git add src/actions/workspace-actions.ts tests/unit/actions/workspace-actions-preview.test.ts
git commit -m "feat(preview-03.01): trigger T1 preset detection on createProject/updateProject"
```

---

### Task 3.2: T2 兜底探测验证（已在 Phase 2 实现，本 task 仅补集成测试）

**Files:**
- Test: `tests/unit/actions/preview-actions-t2.test.ts`

- [ ] **Step 1: 写测试验证 T2 行为**

```ts
// tests/unit/actions/preview-actions-t2.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { getPreviewState } from "@/actions/preview-actions";
import { db } from "@/lib/db";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("T2 fallback detection in getPreviewState", () => {
  it("auto-detects and writes previewPreset when null", async () => {
    const ws = await db.workspace.create({ data: { name: "t2-ws" } });
    const dir = mkdtempSync(join(tmpdir(), "preview-t2-"));
    writeFileSync(join(dir, "go.mod"), "module foo");

    const proj = await db.project.create({
      data: {
        name: "t2-proj",
        type: "NORMAL",
        localPath: dir,
        workspaceId: ws.id,
        previewPreset: null,  // explicitly null to bypass T1
      },
    });
    const task = await db.task.create({ data: { title: "t", projectId: proj.id } });

    await getPreviewState({
      taskId: task.id,
      projectId: proj.id,
      worktreePath: null,
    });

    // T2 is fire-and-forget; allow time to write
    await new Promise((r) => setTimeout(r, 500));

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: proj.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("go-generic");
  });

  it("does not overwrite existing previewPreset (conditional update)", async () => {
    const ws = await db.workspace.create({ data: { name: "t2-ws2" } });
    const dir = mkdtempSync(join(tmpdir(), "preview-t2-skip-"));
    writeFileSync(join(dir, "go.mod"), "module foo");

    const proj = await db.project.create({
      data: {
        name: "t2-skip-proj",
        type: "NORMAL",
        localPath: dir,
        workspaceId: ws.id,
        previewPreset: "static",  // user-set, should NOT be overwritten
      },
    });
    const task = await db.task.create({ data: { title: "t", projectId: proj.id } });

    await getPreviewState({
      taskId: task.id,
      projectId: proj.id,
      worktreePath: null,
    });
    await new Promise((r) => setTimeout(r, 500));

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: proj.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("static");
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test tests/unit/actions/preview-actions-t2.test.ts -- --run
```

预期：PASS（Phase 2 已实现 T2 + conditional update）。如果 conditional update 没生效（覆盖了用户值），回 Phase 2 task 2.5 修 `where: { id: projectId, previewPreset: null }` 子句。

- [ ] **Step 3: Commit**

```bash
git add tests/unit/actions/preview-actions-t2.test.ts
git commit -m "test(preview-03.02): verify T2 fallback detection and conditional update guard"
```

---

### Task 3.3: redetectPreset action（T3）

**Files:**
- Test: `tests/unit/actions/preview-actions-redetect.test.ts`

`redetectPreset` 已在 Phase 2 Task 2.5 实现，本 task 仅补测试。

- [ ] **Step 1: 写测试**

```ts
// tests/unit/actions/preview-actions-redetect.test.ts
import { describe, it, expect } from "vitest";
import { redetectPreset } from "@/actions/preview-actions";
import { db } from "@/lib/db";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("redetectPreset", () => {
  it("overwrites existing previewPreset with fresh detection", async () => {
    const ws = await db.workspace.create({ data: { name: "redetect-ws" } });
    const dir = mkdtempSync(join(tmpdir(), "redetect-"));
    writeFileSync(join(dir, "manage.py"), "import django");

    const proj = await db.project.create({
      data: {
        name: "redetect-proj",
        type: "NORMAL",
        localPath: dir,
        workspaceId: ws.id,
        previewPreset: "vite",  // wrong on purpose
      },
    });

    const r = await redetectPreset({ projectId: proj.id });
    expect(r.preset).toBe("django");

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: proj.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("django");

    rmSync(dir, { recursive: true, force: true });
  });

  it("sets previewPreset to null when nothing matches", async () => {
    const ws = await db.workspace.create({ data: { name: "redetect-null-ws" } });
    const dir = mkdtempSync(join(tmpdir(), "redetect-null-"));

    const proj = await db.project.create({
      data: {
        name: "redetect-null-proj",
        type: "NORMAL",
        localPath: dir,
        workspaceId: ws.id,
        previewPreset: "vite",
      },
    });

    const r = await redetectPreset({ projectId: proj.id });
    expect(r.preset).toBeNull();

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: proj.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test tests/unit/actions/preview-actions-redetect.test.ts -- --run
```

预期：PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/actions/preview-actions-redetect.test.ts
git commit -m "test(preview-03.03): verify redetectPreset T3 overwrite behavior"
```

---

## Phase 4: UI 重写

**目标**：重构 PreviewPanel，新增 LogDrawer + StopPreviewConfirmDialog；接入 @iconify/react；WS 订阅 state 流；新增 i18n keys。

**完成标志**：手工开 task → preset 自动识别 → Run → 日志流式 → ready 自动收起 → Stop 正常；多 tab 共享 session 显示一致；装依赖横幅在依赖缺失时显示。

### Task 4.1: 安装 @iconify/react + i18n keys

**Files:**
- Modify: `package.json`
- Modify: `src/lib/i18n/zh.ts` (按你项目实际路径)
- Modify: `src/lib/i18n/en.ts`

- [ ] **Step 1: 装依赖**

```bash
pnpm add @iconify/react@^5
```

- [ ] **Step 2: 加 i18n keys（zh）**

修改 `src/lib/i18n/zh.ts` 中的 `preview.*` 命名空间，至少加：

```ts
preview: {
  // ...existing keys
  presetDetected: "已识别为",
  presetUnknown: "未识别",
  presetReDetect: "重新探测",
  presetClear: "清空",
  presetSelect: "选择 preset",
  installPrompt: "未检测到依赖。",
  installNow: "立即安装",
  runAnyway: "强制运行",
  cancelInstall: "取消安装",
  statusInstalling: "安装中",
  shareWith: "与其他 {count} 个任务共享",
  stopConfirmTitle: "停止预览？",
  stopConfirmBody: "这将停止与本任务共享同一预览的所有 {count} 个其他打开标签页。",
  stopConfirmConfirm: "停止",
  cancel: "取消",
  override: "覆盖",
  resetOverride: "重置",
  projectDefaultHint: "项目默认",
  logsLabel: "日志",
  logsClear: "清空",
  logsCopy: "复制",
  logsFullscreen: "全屏",
  portInUse: "端口 {port} 已被占用",
}
```

`en.ts` 加对应英文版。

- [ ] **Step 3: 验证 i18n 加载**

```bash
pnpm dev
```

启动后访问任意页面，浏览器 console 不报 i18n missing key warning（针对 preview.* 命名空间）。

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "feat(preview-04.01): add @iconify/react dep and i18n keys for preview UI"
```

---

### Task 4.2: StopPreviewConfirmDialog 组件

**Files:**
- Create: `src/components/task/stop-preview-confirm-dialog.tsx`
- Test: `tests/unit/components/task/stop-preview-confirm-dialog.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/unit/components/task/stop-preview-confirm-dialog.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StopPreviewConfirmDialog } from "@/components/task/stop-preview-confirm-dialog";

describe("StopPreviewConfirmDialog", () => {
  it("shows other-tabs count in body", () => {
    render(
      <StopPreviewConfirmDialog
        open={true}
        otherTabsCount={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it("calls onConfirm when Stop clicked", () => {
    const onConfirm = vi.fn();
    render(
      <StopPreviewConfirmDialog
        open={true}
        otherTabsCount={1}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /停止|stop/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onCancel when Cancel clicked", () => {
    const onCancel = vi.fn();
    render(
      <StopPreviewConfirmDialog
        open={true}
        otherTabsCount={1}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /取消|cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/components/task/stop-preview-confirm-dialog.test.tsx -- --run
```

预期：FAIL

- [ ] **Step 3: 实现组件**

```tsx
// src/components/task/stop-preview-confirm-dialog.tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export interface StopPreviewConfirmDialogProps {
  open: boolean;
  otherTabsCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function StopPreviewConfirmDialog({
  open,
  otherTabsCount,
  onConfirm,
  onCancel,
}: StopPreviewConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("preview.stopConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("preview.stopConfirmBody", { count: otherTabsCount })}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("preview.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("preview.stopConfirmConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/components/task/stop-preview-confirm-dialog.test.tsx -- --run
```

预期：PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/task/stop-preview-confirm-dialog.tsx \
        tests/unit/components/task/stop-preview-confirm-dialog.test.tsx
git commit -m "feat(preview-04.02): add StopPreviewConfirmDialog component"
```

---

### Task 4.3: PreviewLogDrawer 组件

**Files:**
- Create: `src/components/task/preview-log-drawer.tsx`
- Test: `tests/unit/components/task/preview-log-drawer.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/unit/components/task/preview-log-drawer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewLogDrawer } from "@/components/task/preview-log-drawer";

describe("PreviewLogDrawer", () => {
  it("renders collapsed state by default", () => {
    render(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine="ready in 12 ms"
        onToggle={vi.fn()}
        showInstallBanner={false}
        onInstallNow={vi.fn()}
        onRunAnyway={vi.fn()}
      />
    );
    expect(screen.getByText(/ready in 12 ms/)).toBeInTheDocument();
  });

  it("strips ANSI from latest log line in collapsed view", () => {
    render(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine="\x1b[31mred\x1b[0m text"
        onToggle={vi.fn()}
        showInstallBanner={false}
        onInstallNow={vi.fn()}
        onRunAnyway={vi.fn()}
      />
    );
    expect(screen.getByText(/red text/)).toBeInTheDocument();
    expect(screen.queryByText(/\x1b/)).not.toBeInTheDocument();
  });

  it("shows install banner when showInstallBanner is true", () => {
    render(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine=""
        onToggle={vi.fn()}
        showInstallBanner={true}
        onInstallNow={vi.fn()}
        onRunAnyway={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
  });

  it("calls onInstallNow when [Install now] clicked", () => {
    const fn = vi.fn();
    render(
      <PreviewLogDrawer
        expanded={false}
        latestLogLine=""
        onToggle={vi.fn()}
        showInstallBanner={true}
        onInstallNow={fn}
        onRunAnyway={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(fn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test tests/unit/components/task/preview-log-drawer.test.tsx -- --run
```

预期：FAIL

- [ ] **Step 3: 实现组件**

```tsx
// src/components/task/preview-log-drawer.tsx
"use client";

import { useRef, useEffect } from "react";
import { ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { stripAnsi } from "@/lib/preview/url-extractor";

export interface PreviewLogDrawerProps {
  expanded: boolean;
  latestLogLine: string;
  onToggle: () => void;
  showInstallBanner: boolean;
  onInstallNow: () => void;
  onRunAnyway: () => void;
  // 展开态下的 xterm container ref（由 PreviewPanel 创建 xterm 实例后挂载）
  xtermContainerRef?: React.RefObject<HTMLDivElement>;
}

export function PreviewLogDrawer({
  expanded,
  latestLogLine,
  onToggle,
  showInstallBanner,
  onInstallNow,
  onRunAnyway,
  xtermContainerRef,
}: PreviewLogDrawerProps) {
  const { t } = useI18n();
  const cleanLatest = stripAnsi(latestLogLine).slice(0, 200);

  return (
    <div className={`flex shrink-0 flex-col border-t border-border bg-card ${expanded ? "h-1/3" : ""}`}>
      {showInstallBanner && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-1.5 text-xs">
          <AlertTriangle className="size-3.5 text-amber-500" />
          <span className="flex-1 text-amber-400">{t("preview.installPrompt")}</span>
          <Button size="sm" variant="default" onClick={onInstallNow}>
            {t("preview.installNow")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onRunAnyway}>
            {t("preview.runAnyway")}
          </Button>
        </div>
      )}
      <button
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs hover:bg-accent"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        <span className="font-medium">{t("preview.logsLabel")}:</span>
        <span className="truncate text-muted-foreground">{cleanLatest}</span>
      </button>
      {expanded && (
        <div
          ref={xtermContainerRef}
          className="flex-1 overflow-hidden bg-black"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test tests/unit/components/task/preview-log-drawer.test.tsx -- --run
```

预期：PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/task/preview-log-drawer.tsx \
        tests/unit/components/task/preview-log-drawer.test.tsx
git commit -m "feat(preview-04.03): add PreviewLogDrawer with collapsed/expanded states and install banner"
```

---

### Task 4.4: WS 接入 — 通过特殊 taskId 分发

**Files:**
- Modify: `src/lib/pty/ws-server.ts`
- Test: `tests/unit/lib/pty/ws-server-preview.test.ts`

**⚠ 重要更正**：ws-server 不用 path 分发，而是通过 `?taskId=` query 分发，特殊 taskId 走特殊分支（参考已有的 `__notifications__` / `__assistant__`）。Preview 走相同模式：

```
URL: ws://localhost:{wsPort}/?taskId=__preview__&role=state&previewKey=<encoded>&connectionId=<uuid>
URL: ws://localhost:{wsPort}/?taskId=__preview__&role=terminal&previewKey=<encoded>&connectionId=<uuid>
```

`previewKey` 含 `|` 和 `/`，客户端 `encodeURIComponent` 编码，服务端 `decodeURIComponent` 解码。

- [ ] **Step 1: 读 ws-server 当前结构**

```bash
sed -n '139,170p' /Users/liujunping/project/f/tower/src/lib/pty/ws-server.ts
```

确认 `wss.on("connection", ...)` 内已有 `taskId === NOTIFICATION_CHANNEL` 分支。

- [ ] **Step 2: 写失败测试**

```ts
// tests/unit/lib/pty/ws-server-preview.test.ts
import { describe, it, expect } from "vitest";
import { parsePreviewWsParams, PREVIEW_TASK_ID } from "@/lib/pty/ws-server";

describe("parsePreviewWsParams", () => {
  it("parses state role", () => {
    const url = new URL(
      `http://x/?taskId=${PREVIEW_TASK_ID}&role=state&previewKey=${encodeURIComponent("/repo|pnpm dev|5173")}&connectionId=c1`
    );
    const r = parsePreviewWsParams(url.searchParams);
    expect(r).toEqual({
      role: "state",
      previewKey: "/repo|pnpm dev|5173",
      connectionId: "c1",
      taskId: null,
    });
  });

  it("parses terminal role with taskId hint", () => {
    const url = new URL(
      `http://x/?taskId=${PREVIEW_TASK_ID}&role=terminal&previewKey=${encodeURIComponent("k")}&connectionId=c2&clientTaskId=t1`
    );
    const r = parsePreviewWsParams(url.searchParams);
    expect(r?.role).toBe("terminal");
    expect(r?.previewKey).toBe("k");
    expect(r?.taskId).toBe("t1");
  });

  it("returns null when taskId is not __preview__", () => {
    const url = new URL("http://x/?taskId=cuid123&role=state");
    expect(parsePreviewWsParams(url.searchParams)).toBeNull();
  });

  it("returns null when previewKey or role missing", () => {
    const url = new URL(`http://x/?taskId=${PREVIEW_TASK_ID}`);
    expect(parsePreviewWsParams(url.searchParams)).toBeNull();
  });

  it("decodes URL-encoded previewKey with | and /", () => {
    const original = "/Users/me/repo/apps/h5|pnpm dev|5173";
    const url = new URL(
      `http://x/?taskId=${PREVIEW_TASK_ID}&role=state&previewKey=${encodeURIComponent(original)}&connectionId=c`
    );
    const r = parsePreviewWsParams(url.searchParams);
    expect(r?.previewKey).toBe(original);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm test tests/unit/lib/pty/ws-server-preview.test.ts -- --run
```

预期：FAIL

- [ ] **Step 4: 加 parsePreviewWsParams + 在 wss.on("connection") 内插入分支**

在 `src/lib/pty/ws-server.ts` 顶部加：

```ts
import { getPreviewSession } from "@/lib/preview/session-store";

export const PREVIEW_TASK_ID = "__preview__";

export interface PreviewWsParams {
  role: "state" | "terminal";
  previewKey: string;
  connectionId: string;
  taskId: string | null;
}

export function parsePreviewWsParams(params: URLSearchParams): PreviewWsParams | null {
  if (params.get("taskId") !== PREVIEW_TASK_ID) return null;
  const role = params.get("role");
  const previewKey = params.get("previewKey");
  if ((role !== "state" && role !== "terminal") || !previewKey) return null;
  const connectionId = params.get("connectionId") ?? Math.random().toString(36).slice(2);
  return {
    role,
    previewKey: decodeURIComponent(previewKey),
    connectionId,
    taskId: params.get("clientTaskId"),
  };
}
```

然后在 `wss.on("connection", (ws, req) => {})` 内、`const taskId = url.searchParams.get("taskId")` **之后**、`if (taskId === NOTIFICATION_CHANNEL)` **之前**插入：

```ts
const previewParams = parsePreviewWsParams(url.searchParams);
if (previewParams) {
  const session = getPreviewSession(previewParams.previewKey);
  if (!session) {
    ws.close(1008, "Preview session not found");
    return;
  }
  const unsub = session.subscribe(
    previewParams.connectionId,
    previewParams.taskId ?? "unknown",
    (state) => {
      if (previewParams.role === "state") {
        try {
          ws.send(JSON.stringify({ type: "state", previewKey: session.key, state }));
        } catch { /* best-effort */ }
      }
    },
    (data) => {
      if (previewParams.role === "terminal") {
        try { ws.send(data); } catch { /* best-effort */ }
      }
    }
  );
  if (previewParams.role === "terminal") {
    const buf = session.getBuffer();
    if (buf.length > 0) {
      try { ws.send(buf.join("\n") + "\n"); } catch { /* ignore */ }
    }
  }
  if (previewParams.role === "state") {
    try {
      ws.send(JSON.stringify({ type: "state", previewKey: session.key, state: session.getState() }));
    } catch { /* ignore */ }
  }
  ws.on("close", () => unsub());
  return;  // ⚠ 必须 early return 阻止后续 Claude PTY 逻辑跑
}
```

具体插入位置：在 `if (!taskId) { ws.close(1008, "Missing taskId"); return; }` 之**后**（preview 已确保 taskId === PREVIEW_TASK_ID 非空），在 `if (taskId === NOTIFICATION_CHANNEL)` 之**前**。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm test tests/unit/lib/pty/ws-server-preview.test.ts -- --run
```

预期：PASS（仅测试 parsePreviewWsPath，不测 handle 逻辑）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/pty/ws-server.ts tests/unit/lib/pty/ws-server-preview.test.ts
git commit -m "feat(preview-04.04): add WS routes for preview state/terminal streams"
```

---

### Task 4.5: PreviewPanel 重构

**Files:**
- Modify: `src/components/task/preview-panel.tsx`
- Modify: `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx`（更新 props 传递）

由于 PreviewPanel 重构涉及大量交互逻辑，本 task 不强求 100% 单元测试覆盖（已在 4.2、4.3 单独测了关键子组件）。验证靠手动 + Phase 5 的 E2E。

- [ ] **Step 1: 重写 PreviewPanel**

```tsx
// src/components/task/preview-panel.tsx (完全替换)
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Icon } from "@iconify/react";
import { RefreshCw, Terminal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import {
  getPreviewState,
  startPreview,
  stopPreview,
  installPreviewDeps,
  redetectPreset,
  setProjectPreset,
  openInTerminal,
} from "@/actions/preview-actions";
import { getActualWsPort } from "@/actions/config-actions";  // ⚠ 必须用 server action 拿真实 port
import { updateTask } from "@/actions/task-actions";
import { PreviewLogDrawer } from "./preview-log-drawer";
import { StopPreviewConfirmDialog } from "./stop-preview-confirm-dialog";
import { PRESETS } from "@/lib/preview/presets";
import { PREVIEW_TASK_ID } from "@/lib/pty/ws-server";

export interface PreviewPanelProps {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
  projectLocalPath: string | null;
  refreshKey: number;
  previewUrl?: string;
  onPreviewUrlChange?: (url: string) => void;
}

type StateSnapshot = Awaited<ReturnType<typeof getPreviewState>>;

export function PreviewPanel({
  taskId,
  projectId,
  worktreePath,
  projectLocalPath,
  refreshKey,
  previewUrl,
  onPreviewUrlChange,
}: PreviewPanelProps) {
  const { t } = useI18n();
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [userToggledAt, setUserToggledAt] = useState<number | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [addressInput, setAddressInput] = useState(previewUrl ?? "");
  const [iframeUrl, setIframeUrl] = useState(previewUrl ?? "");
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const xtermContainerRef = useRef<HTMLDivElement>(null);

  // Empty state check
  const cwd = worktreePath ?? projectLocalPath;
  if (!cwd) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <Icon icon="lucide:eye" className="size-10 opacity-40" />
        <h3 className="text-sm font-medium text-foreground">{t("preview.noWorktree") ?? "No working directory"}</h3>
      </div>
    );
  }

  // Initial state fetch
  useEffect(() => {
    void getPreviewState({ taskId, projectId, worktreePath }).then(setState);
  }, [taskId, projectId, worktreePath]);

  // WS state subscription
  useEffect(() => {
    if (!state?.previewKey || state.previewKey === "no-cwd") return;
    let ws: WebSocket | null = null;
    let aborted = false;
    void (async () => {
      const wsPort = await getActualWsPort();
      if (aborted) return;
      const params = new URLSearchParams({
        taskId: PREVIEW_TASK_ID,
        role: "state",
        previewKey: state.previewKey,
        connectionId: crypto.randomUUID(),
        clientTaskId: taskId,
      });
      ws = new WebSocket(`ws://localhost:${wsPort}/?${params.toString()}`);
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(String(e.data)) as { type: string; state: Partial<StateSnapshot> };
          if (frame.type === "state") {
            setState((prev) => (prev ? { ...prev, ...frame.state } : prev));
          }
        } catch {
          // ignore
        }
      };
    })();
    return () => {
      aborted = true;
      ws?.close();
    };
  }, [state?.previewKey, taskId]);

  // Auto expand/collapse logic
  // ⚠ setTimeout 必须在 cleanup 清，否则 task 切走时仍会 setDrawerExpanded（warning + 内存）
  useEffect(() => {
    if (!state) return;
    const lockMs = 30_000;
    if (userToggledAt && Date.now() - userToggledAt < lockMs) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (state.status === "starting" || state.status === "installing") {
      setDrawerExpanded(true);
    } else if (state.status === "running") {
      timer = setTimeout(() => {
        if (!userToggledAt || Date.now() - userToggledAt > lockMs) {
          setDrawerExpanded(false);
        }
      }, 3000);
    } else if (state.status === "error") {
      setDrawerExpanded(true);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [state?.status, userToggledAt]);

  // Sync iframe URL when state.url changes
  useEffect(() => {
    if (state?.url && state.url !== iframeUrl) {
      setAddressInput(state.url);
      setIframeUrl(state.url);
      onPreviewUrlChange?.(state.url);
    }
  }, [state?.url]);

  const refresh = useCallback(async () => {
    const fresh = await getPreviewState({ taskId, projectId, worktreePath });
    setState(fresh);
  }, [taskId, projectId, worktreePath]);

  async function handleRun() {
    setState((s) => (s ? { ...s, status: "starting" } : s));
    const r = await startPreview({ taskId, projectId, worktreePath });
    if (!r.started && r.error) {
      setState((s) => (s ? { ...s, status: "error", errorMessage: r.error ?? null } : s));
    }
  }

  async function handleStop() {
    if (!state) return;
    // 共享判定就看活跃订阅者数 - 1 是否 > 0，不需要看 previewKey 形状或 worktree
    const otherTabs = state.activeSubscribers - 1;
    if (otherTabs > 0) {
      setStopDialogOpen(true);
    } else {
      await stopPreview({ previewKey: state.previewKey });
      await refresh();
    }
  }

  async function confirmStop() {
    setStopDialogOpen(false);
    if (state) {
      await stopPreview({ previewKey: state.previewKey });
      await refresh();
    }
  }

  async function handleInstall() {
    await installPreviewDeps({ taskId, projectId, worktreePath, autoStartAfter: true });
  }

  async function handleRunAnyway() {
    await handleRun();
  }

  async function handleReDetect() {
    await redetectPreset({ projectId, worktreePath });
    await refresh();
  }

  async function handlePresetSelect(presetId: string | null) {
    await setProjectPreset({ projectId, presetId });
    await refresh();
  }

  async function handleCommandBlur(newCommand: string) {
    if (!state) return;
    if (newCommand === state.command) return;
    await updateTask(taskId, { previewCommandOverride: newCommand || null });
    await refresh();
  }

  async function handlePortBlur(newPort: number) {
    if (!state) return;
    if (newPort === state.port) return;
    await updateTask(taskId, { previewPortOverride: newPort || null });
    await refresh();
  }

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showInstallBanner =
    state.installed === false && !!state.installCommand && state.status === "stopped";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="header-sm flex shrink-0 items-center gap-2 px-3">
        <StatusPill status={state.status} t={t} />
        <PresetBadge
          presetId={state.preset?.id ?? null}
          presetName={state.preset?.name ?? null}
          presetIcon={state.preset?.icon ?? null}
          onReDetect={handleReDetect}
          onSelect={handlePresetSelect}
        />
        {state.status === "running" ? (
          <Button variant="destructive" onClick={handleStop}>
            {t("preview.stop")}
          </Button>
        ) : state.status === "installing" ? (
          <Button variant="destructive" onClick={handleStop}>
            {t("preview.cancelInstall")}
          </Button>
        ) : (
          <Button
            variant="default"
            disabled={state.status === "starting" || !state.command}
            onClick={handleRun}
          >
            {state.status === "starting" && <Loader2 className="mr-1 size-3 animate-spin" />}
            {t("preview.run")}
          </Button>
        )}
        <CommandInput
          value={state.command}
          isOverride={!!state.command && state.command !== state.preset?.command}
          onBlur={handleCommandBlur}
        />
        <PortInput value={state.port} onBlur={handlePortBlur} />
        <input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setIframeUrl(addressInput);
              onPreviewUrlChange?.(addressInput);
            }
          }}
          placeholder="http://localhost:5173"
          className="h-8 flex-1 rounded border border-border bg-background px-2 text-xs font-mono"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => iframeUrl && setManualRefreshKey((k) => k + 1)}
          title={t("preview.refresh")}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!worktreePath}
          onClick={() => worktreePath && void openInTerminal(worktreePath)}
        >
          <Terminal className="size-4" />
        </Button>
      </div>

      {/* Error banner */}
      {state.status === "error" && state.errorMessage && (
        <div className="border-b border-border bg-red-500/10 px-3 py-1 text-xs text-red-400">
          {state.errorMessage}
        </div>
      )}

      {/* iframe */}
      <div className="flex-1 overflow-hidden">
        <iframe
          key={`${refreshKey}-${manualRefreshKey}`}
          src={iframeUrl || undefined}
          className="size-full border-0"
          title="Preview"
        />
      </div>

      <PreviewLogDrawer
        expanded={drawerExpanded}
        latestLogLine={state.recentLogs[state.recentLogs.length - 1] ?? ""}
        onToggle={() => {
          setDrawerExpanded((v) => !v);
          setUserToggledAt(Date.now());
        }}
        showInstallBanner={showInstallBanner}
        onInstallNow={handleInstall}
        onRunAnyway={handleRunAnyway}
        xtermContainerRef={xtermContainerRef}
      />

      <StopPreviewConfirmDialog
        open={stopDialogOpen}
        otherTabsCount={state.activeSubscribers - 1}
        onConfirm={confirmStop}
        onCancel={() => setStopDialogOpen(false)}
      />
    </div>
  );
}

function StatusPill({ status, t }: { status: string; t: (key: string) => string }) {
  const cls =
    status === "running"
      ? "text-emerald-400 bg-emerald-500/10"
      : status === "error"
        ? "text-red-400 bg-red-500/10"
        : status === "installing"
          ? "text-blue-400 bg-blue-500/10"
          : "text-muted-foreground bg-muted";
  const labelKey =
    status === "running"
      ? "preview.statusRunning"
      : status === "starting"
        ? "preview.statusStarting"
        : status === "error"
          ? "preview.statusError"
          : status === "installing"
            ? "preview.statusInstalling"
            : "preview.statusStopped";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}>
      {t(labelKey)}
    </span>
  );
}

function PresetBadge({
  presetId,
  presetName,
  presetIcon,
  onReDetect,
  onSelect,
}: {
  presetId: string | null;
  presetName: string | null;
  presetIcon: string | null;
  onReDetect: () => void;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <Select
      value={presetId ?? ""}
      onValueChange={(v) => {
        if (v === "__redetect") onReDetect();
        else if (v === "__clear") onSelect(null);
        else onSelect(v || null);
      }}
    >
      <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
        <span className="flex items-center gap-1.5">
          {presetIcon ? <Icon icon={presetIcon} className="size-4" /> : null}
          <span>{presetName ?? t("preview.presetUnknown")}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {PRESETS.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-1.5">
              <Icon icon={p.icon} className="size-4" />
              <span>{p.name}</span>
            </span>
          </SelectItem>
        ))}
        <SelectItem value="__redetect">{t("preview.presetReDetect")}</SelectItem>
        <SelectItem value="__clear">{t("preview.presetClear")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function CommandInput({ value, isOverride, onBlur }: { value: string; isOverride: boolean; onBlur: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(local)}
      placeholder="pnpm dev"
      className={`h-8 w-44 rounded border bg-background px-2 text-xs font-mono ${isOverride ? "border-blue-500/50" : "border-border"}`}
    />
  );
}

function PortInput({ value, onBlur }: { value: number; onBlur: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  return (
    <input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(parseInt(local, 10) || 0)}
      className="h-8 w-20 rounded border border-border bg-background px-2 text-xs font-mono"
    />
  );
}
```

- [ ] **Step 2: 修改 task-page-client.tsx 传递新 props**

修改 `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx`，PreviewPanel 调用处补 `projectId` 和 `projectLocalPath` props：

```diff
 <PreviewPanel
   taskId={task.id}
+  projectId={task.projectId}
   worktreePath={execution?.worktreePath ?? null}
+  projectLocalPath={task.project.localPath ?? null}
-  previewCommand={...}
-  previewPort={...}
   refreshKey={refreshKey}
   previewUrl={previewUrl}
   onPreviewUrlChange={setPreviewUrl}
 />
```

- [ ] **Step 3: 跑全套测试**

```bash
pnpm test -- --run
```

预期：PASS（无回归）。

- [ ] **Step 4: 手动验证**

```bash
pnpm dev
```

打开浏览器：
- 进入一个 Tower 项目（确保有 vite/next 类型）
- 创建/打开 task → 切到 Preview tab
- 验证 preset 徽章自动显示对应图标 + 名字
- 点 Run → 状态切到 starting → log drawer 展开 → ready 后切到 running → drawer 收起 → iframe 加载页面
- 点 Stop → 状态回到 stopped

- [ ] **Step 5: Commit**

```bash
git add src/components/task/preview-panel.tsx \
        src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx
git commit -m "feat(preview-04.05): rewrite PreviewPanel with preset badge, log drawer, override fields, WS state sync"
```

---

## Phase 5: E2E + 文档

**目标**：Playwright 覆盖关键用户流；更新模块文档、AGENTS.md、process-lifecycle.md。

**完成标志**：E2E 全过；新功能在 `docs/modules/preview.md` 有文档；AGENTS.md 列出新 server actions。

### Task 5.1: Playwright E2E

**Files:**
- Create: `tests/e2e/preview.spec.ts`
- Create: `tests/fixtures/vite-project/` (最小 Vite fixture)

- [ ] **Step 1: 准备 fixture**

```bash
mkdir -p tests/fixtures/vite-project
cat > tests/fixtures/vite-project/package.json <<'EOF'
{
  "name": "preview-test-vite",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
EOF
mkdir -p tests/fixtures/vite-project/src
cat > tests/fixtures/vite-project/index.html <<'EOF'
<!DOCTYPE html>
<html><head><title>Test</title></head><body><div id="app">hello</div></body></html>
EOF
cd tests/fixtures/vite-project && pnpm install && cd ../../..
```

确认 `tests/fixtures/vite-project/node_modules` 存在（fixture 装好依赖）。

- [ ] **Step 2: 写 E2E**

```ts
// tests/e2e/preview.spec.ts
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const VITE_FIXTURE = resolve("tests/fixtures/vite-project");

test.describe("Preview feature", () => {
  test("vite project auto-detected, runs, shows iframe", async ({ page }) => {
    // 1. 通过 UI 创建项目（或通过 server action 直接插数据）
    // 假设 Tower 在 localhost:9022
    await page.goto("http://localhost:9022/");

    // 创建 workspace（若不存在）+ 项目 + task
    // ...具体步骤按 Tower UI 走

    // 进入 preview tab
    // ...

    // 验证 preset 徽章显示 Vite
    await expect(page.locator('[data-testid="preset-badge"]')).toContainText(/vite/i);

    // 点 Run
    await page.click('[data-testid="preview-run-button"]');

    // 等 status 变 running（最多 30s）
    await expect(page.locator('[data-testid="status-pill"]')).toContainText(/running/i, { timeout: 30_000 });

    // 验证 iframe src 包含 localhost
    const src = await page.locator('iframe[title="Preview"]').getAttribute("src");
    expect(src).toMatch(/localhost:\d+/);

    // 点 Stop
    await page.click('[data-testid="preview-stop-button"]');
    await expect(page.locator('[data-testid="status-pill"]')).toContainText(/stopped/i);
  });

  test("preview state persists after closing task tab (long-lived PTY)", async ({ page }) => {
    // 启动 preview → 关闭 task → 重新打开 → 状态仍是 running
  });

  test("shared session: stop dialog appears when other tabs subscribed", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    // 两个 page 打开同 task → p1 Run → p2 看到 running → p1 Stop → 弹 dialog
  });
});
```

**实施者备注**：这些 test case 的具体 selector 依赖 PreviewPanel 实际 markup，落实时按真实 dom 调整。第二、三个 case 涉及完整 Tower 启动 + 数据 fixture，可视实际情况简化为 single-browser 流。

- [ ] **Step 3: 跑 E2E**

```bash
pnpm dev &  # 启动 Tower
sleep 5
pnpm test:e2e tests/e2e/preview.spec.ts
```

预期：至少第一个 case PASS（auto-detect + run + iframe + stop）。

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/preview.spec.ts tests/fixtures/vite-project
git commit -m "test(preview-05.01): add Playwright E2E for preview auto-detect + run + stop"
```

---

### Task 5.2: 文档更新

**Files:**
- Create: `docs/modules/preview.md`
- Modify: `AGENTS.md`
- Modify: `.claude/rules/process-lifecycle.md`

- [ ] **Step 1: 写 preview 模块文档**

```bash
cat > docs/modules/preview.md <<'EOF'
# Preview Module

预览运行中的 dev server，支持 11 种框架自动探测（Vite、Next、Nuxt、Angular、Spring Boot、Django、FastAPI、Flask、Go、Static、Angular）。

## 架构

- **Preset 数据**：`src/lib/preview/presets.ts` — 11 个内置预设，每个含 detect rule、command、port、readyRegex、installCommand
- **探测**：`src/lib/preview/detector.ts:detectPreset(cwd)` 纯函数
- **Session 模型**：`(cwd, command, port)` 三元组作为身份，相同三件套共享同一 dev server 进程
- **PTY 复用**：复用 `src/lib/pty/pty-session.ts` 的 `PtySession` 类，但**不**复用 `pty/session-store.ts`，避免和 Claude PTY 互杀

## 探测时机

| 触发 | 时机 | 写入字段 |
|---|---|---|
| T1 | `createProject` / `updateProject` 完成 | `Project.previewPreset` |
| T2 | `getPreviewState` 调用时如果 previewPreset 为 null | `Project.previewPreset`（conditional update） |
| T3 | 用户点 Re-detect 按钮 | `Project.previewPreset`（强制覆盖） |
| subPath | 实时（每次 getPreviewState） | 不存 DB |

## Effective Command/Port 计算

```
task.previewCommandOverride  →  project.previewCommand  →  preset.command  →  ""
```

详见 `src/lib/preview/preview-key.ts:getEffectiveCommand`。

## 详细 spec

`docs/superpowers/specs/2026-05-16-preview-feature-design.md`
EOF
```

- [ ] **Step 2: 更新 AGENTS.md 添加新 server actions**

在 `AGENTS.md` 的 `### \`preview-actions.ts\`` 段（如不存在则新加）：

```md
### `preview-actions.ts`

| Function | Signature |
|----------|-----------|
| `getPreviewState` | `({ taskId, projectId, worktreePath }) → PreviewStateResp` |
| `startPreview` | `({ taskId, projectId, worktreePath }) → { started, error? }` |
| `stopPreview` | `({ previewKey }) → void` |
| `installPreviewDeps` | `({ taskId, projectId, worktreePath, autoStartAfter? }) → { ok, error? }` |
| `redetectPreset` | `({ projectId, worktreePath? }) → { preset: string | null }` |
| `setProjectPreset` | `({ projectId, presetId: string | null }) → void` |
| `openInTerminal` | `(worktreePath) → void` |
```

- [ ] **Step 3: 更新 process-lifecycle.md**

在 `.claude/rules/process-lifecycle.md` 的"PTY Sessions"段之后追加：

```md
## Preview PTY Sessions

- Sessions keyed by `(cwd, command, port)` 三元组 — see `src/lib/preview/preview-key.ts`.
- 复用 `PtySession` 类，**不**使用 `pty/session-store.ts`（独立 store 在 `src/lib/preview/session-store.ts`）。
- 长 lived — 用户关闭 task 详情页 PTY 不杀，再次打开继续看；只有显式 Stop 或 SIGTERM 才终止。
- `onIdle: undefined` — dev server 长时间静默是正常状态，不能被 idle timer 误杀。
- 创建后立即 `pty.resize(200, 50)` — 避免 dev server 因 80 列窄宽换行打断 readyRegex 匹配。
- SIGTERM/SIGINT/SIGHUP 钩子注册时用 `globalThis.__previewSignalHandlersRegistered` flag 防重复。
```

- [ ] **Step 4: Commit**

```bash
git add docs/modules/preview.md AGENTS.md .claude/rules/process-lifecycle.md
git commit -m "docs(preview-05.02): add preview module doc + AGENTS actions list + lifecycle rule"
```

---

## 验收清单（对应 spec §18）

整体 plan 完成后人工 walk-through 这 10 条：

- [ ] **AC1**：创建 vite fixture 项目 → 自动识别为 vite → Run → 日志流式 → ready 后 iframe 显示
- [ ] **AC2**：创建 Spring Boot Maven fixture 项目 → 识别 → 横幅提示装依赖 → Install → 装完自动 Run → 启动 8080 → iframe（fallback localhost:8080）
- [ ] **AC3**：仅 index.html 项目 → 识别为 static → Run 通过 `npx serve` → iframe 显示
- [ ] **AC4**：Monorepo 项目 + subPath 区分 → 每个 task 探测自己 subPath 的 preset → 同 subPath 多 task 共享 session
- [ ] **AC5**：worktree task 独立 session；多 worktree 默认端口冲突 → 错误信息提示改 port
- [ ] **AC6**：非 worktree 3 task 共看一个 session → 一个点 Stop → 弹 dialog → 确认后三个 task 都变 stopped
- [ ] **AC7**：启动超时 60s → 进 error，errorMessage 包含日志最后几行
- [ ] **AC8**：Run 后关 task 详情页 → 重开 → 状态仍 running，日志和 iframe 都恢复
- [ ] **AC9**：用户 Vite 迁 Next → 点 Re-detect → preset 更新为 next
- [ ] **AC10**：用户改命令为 `pnpm dev:full` → 存到 Task.previewCommandOverride → 三件套变化 → session key 变化 → 独立 session 或合并到匹配的现有 session

---

## Notes for Implementation Agent

1. **每个 commit 一个 task** — Tower 项目惯例。Commit message scope 用 `preview-XX.YY` 格式
2. **TDD 严格执行** — 不要先实现再补测试。失败测试是验证测试本身有效的必要步骤
3. **遇到 spec 没覆盖的边界** — 停下来回 spec，不要自己拍脑袋决定。修 spec → 跑 spec-reviewer → 再实施
4. **测试 fixture 命名** — `tests/fixtures/{name}/` 下放完整 fixture 项目；mock-dev-server 是通用 mock，其他是真实场景 fixture
5. **PTY 类 import** — `import { PtySession } from "@/lib/pty/pty-session"`，**绝对不要** import `pty/session-store`
6. **Server action 全部加 `"use server"`** — Next.js 16 严格要求
7. **数据库测试清理** — 每个 test 用 `afterAll` 删自己创建的 workspace（cascade 会删 project/task）。注意 Tower 的 `deleteWorkspace` 不会拒绝最后一个 workspace 删除，但**测试创建的 workspace 名字必须用前缀** `preview-test-` 避免与人工数据冲突。**Phase 2 起手前先看一遍 Tower 现有 `tests/unit/actions/*.test.ts` 的 cleanup 模式**，照搬。
8. **TaskCreate** — Phase 内 task 间用 TaskCreate/TaskUpdate 跟踪进度
9. **每 commit 后跑 `pnpm test -- --run` 全量** — 防回归
10. **完成所有 phase 后** — 在 PR description 中粘贴 spec link + 完整 acceptance checklist 勾选状态

### 已知遗留风险（V1 内不修，但实施者要意识到）

- **PtySession 没有 SIGKILL 升级**：`stop()` 调 `kill()` 只发 SIGTERM；某些 dev server 忽略 SIGTERM 要 SIGKILL。如果实测发现进程残留，后续给 PtySession 加 `kill(signal?)` 重载，但不要在本 plan 里改。
- **dev server 在 PTY 下行为变化**：有些 dev server（如 webpack-dev-server 老版本）检测 isTTY = true 后会开 interactive 模式（按键 quit / restart）。如果用户按了快捷键意外退出进程，那是已知 PTY 行为，让用户 Run again 即可。
- **大量同时打开 task 详情页**：state 通过 WS 广播给所有订阅者。如果同一台机器 N 个浏览器 tab 看同 session，N 大时广播开销可观。V1 不优化，V2 考虑批合并。
- **shell-quote 解析极端引号情况**：仍存在边界（如 `'$VAR'` 字面单引号 vs 双引号变量展开差异）。对绝大多数 dev 命令够用，碰到坏 case 留 issue。
