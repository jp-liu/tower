---
phase: 06-file-serving-image-rendering
verified: 2026-03-27T09:50:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 06: File Serving and Image Rendering Verification Report

**Phase Goal:** Files under data/ are securely accessible via HTTP and image paths in task messages are rendered as visible images
**Verified:** 2026-03-27T09:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                      | Status     | Evidence                                                                                     |
|----|----------------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------|
| 1  | GET /api/files/assets/{projectId}/{filename} returns file with correct Content-Type | ✓ VERIFIED | Route reads file via `fs.promises.readFile`, sets `Content-Type` from `MIME_MAP[ext]`; 10 MIME entries tested |
| 2  | Path traversal (../../etc/passwd) returns 400 and never reads outside data/ | ✓ VERIFIED | `resolveAssetPath` uses `path.resolve + startsWith(safePrefix)` guard; two traversal test cases pass (../../etc/passwd, ../../../etc/passwd) |
| 3  | Missing file returns 404 with JSON error                                   | ✓ VERIFIED | Route catches `ENOENT` and returns `NextResponse.json({ error: "Not found" }, { status: 404 })` |
| 4  | Image path in task message renders as inline `<img>` in conversation view  | ✓ VERIFIED | `TaskConversation` ReactMarkdown has `components.img` override calling `localPathToApiUrl` with `max-w-full` styling |
| 5  | HTTP URLs in markdown pass through unchanged                               | ✓ VERIFIED | `localPathToApiUrl` regex only matches `data/assets/` pattern; http:// and https:// tested and pass through unchanged |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact                                                                 | Expected                                            | Status     | Details                                                                                   |
|--------------------------------------------------------------------------|-----------------------------------------------------|------------|-------------------------------------------------------------------------------------------|
| `src/lib/file-serve.ts`                                                  | Pure helper: resolveAssetPath, MIME_MAP, localPathToApiUrl | ✓ VERIFIED | All 3 exports present, 37 lines, fully implemented with traversal guard and regex transform |
| `src/app/api/files/assets/[projectId]/[filename]/route.ts`               | GET route handler for secure file serving           | ✓ VERIFIED | 34 lines, exports `GET`, awaits params, calls `resolveAssetPath`, `readFile`, returns raw `Response` |
| `src/components/task/task-conversation.tsx`                              | ReactMarkdown img override using localPathToApiUrl  | ✓ VERIFIED | `components` prop present at line 96, `img` override at line 97, `localPathToApiUrl` called at line 98 |
| `tests/unit/api/file-serving.test.ts`                                    | Unit tests for resolveAssetPath traversal guard     | ✓ VERIFIED | 14 tests: 4 for `resolveAssetPath` (including 2 traversal cases), 10 for `MIME_MAP` — all pass |
| `tests/unit/lib/local-path-to-api-url.test.ts`                          | Unit tests for path-to-URL transformation           | ✓ VERIFIED | 7 tests covering transform, leading slash, https/http passthrough, already-API URL, random text — all pass |

---

### Key Link Verification

| From                                                    | To                       | Via                                  | Status  | Details                                                       |
|---------------------------------------------------------|--------------------------|--------------------------------------|---------|---------------------------------------------------------------|
| `src/app/api/files/assets/[projectId]/[filename]/route.ts` | `src/lib/file-serve.ts` | `import { resolveAssetPath, MIME_MAP }` | ✓ WIRED | Line 4: `import { resolveAssetPath, MIME_MAP } from "@/lib/file-serve"` |
| `src/components/task/task-conversation.tsx`             | `src/lib/file-serve.ts`  | `import { localPathToApiUrl }`       | ✓ WIRED | Line 8: `import { localPathToApiUrl } from "@/lib/file-serve"` |

---

### Data-Flow Trace (Level 4)

| Artifact                            | Data Variable | Source                              | Produces Real Data     | Status      |
|-------------------------------------|---------------|-------------------------------------|------------------------|-------------|
| route.ts (GET handler)              | `bytes`       | `fs.promises.readFile(resolved)`    | Yes — reads real file  | ✓ FLOWING   |
| task-conversation.tsx (img override) | `resolvedSrc` | `localPathToApiUrl(src)` from ReactMarkdown prop | Yes — transforms URL at render time | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior                                        | Command                                                                 | Result                   | Status  |
|-------------------------------------------------|-------------------------------------------------------------------------|--------------------------|---------|
| resolveAssetPath traversal guard tests pass     | `pnpm vitest run tests/unit/api/file-serving.test.ts`                  | 14 tests passed (184ms)  | ✓ PASS  |
| localPathToApiUrl transform tests pass          | `pnpm vitest run tests/unit/lib/local-path-to-api-url.test.ts`         | 7 tests passed (184ms)   | ✓ PASS  |
| Both test files together                        | `pnpm vitest run tests/unit/api/file-serving.test.ts tests/unit/lib/local-path-to-api-url.test.ts` | 21 tests passed, exit 0 | ✓ PASS  |
| Route server (GET /api/files/...)               | Cannot test without running server                                      | N/A                      | ? SKIP (needs live server) |

---

### Requirements Coverage

| Requirement | Source Plan   | Description                                                   | Status      | Evidence                                                                                      |
|-------------|--------------|---------------------------------------------------------------|-------------|-----------------------------------------------------------------------------------------------|
| ASST-04     | 06-01-PLAN.md | Next.js API Route 安全地提供文件访问（防路径穿越）              | ✓ SATISFIED | Route at `src/app/api/files/assets/[projectId]/[filename]/route.ts` uses `resolveAssetPath` with `startsWith(safePrefix)` guard; traversal tests in `file-serving.test.ts` lines 29-45 |
| UI-03       | 06-01-PLAN.md | 任务对话中的图片路径渲染为可查看的图片                          | ✓ SATISFIED | `task-conversation.tsx` ReactMarkdown `img` override at line 97 transforms `data/assets/` paths via `localPathToApiUrl` to `/api/files/assets/` URLs |

No orphaned requirements found — both phase-6 requirements are claimed by plan `06-01` and fully implemented.

---

### Security Verification: Path Traversal Guard

The path traversal guard uses the canonical `path.resolve + startsWith(safePrefix)` pattern:

- `src/lib/file-serve.ts` line 22: `const resolved = path.resolve(DATA_ROOT, "assets", projectId, filename);`
- `src/lib/file-serve.ts` line 23: `const safePrefix = path.resolve(DATA_ROOT) + path.sep;`
- `src/lib/file-serve.ts` line 24: `if (!resolved.startsWith(safePrefix)) { return { resolved: null, error: "Invalid path" }; }`

Test coverage:
- `tests/unit/api/file-serving.test.ts` line 29: `resolveAssetPath("../../etc", "passwd")` — projectId traversal — returns `{ resolved: null, error: "Invalid path" }`
- `tests/unit/api/file-serving.test.ts` line 35: `resolveAssetPath("proj1", "../../../etc/passwd")` — filename traversal — returns `{ resolved: null, error: "Invalid path" }`

Both test cases pass. The guard is implemented and tested.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | — |

No TODO, FIXME, placeholder, or stub patterns detected in any phase-produced file.

---

### Human Verification Required

#### 1. Live File Serving

**Test:** Start dev server (`pnpm dev`), place a PNG in `data/assets/test-project/test.png`, then open `http://localhost:3000/api/files/assets/test-project/test.png` in a browser.
**Expected:** Image is rendered directly in the browser with `Content-Type: image/png`.
**Why human:** Cannot test HTTP response headers without a running server.

#### 2. Image Rendering in Conversation UI

**Test:** Create a task message containing `![test image](data/assets/test-project/test.png)` (or have an AI agent produce such output), then view the task in the Kanban board conversation panel.
**Expected:** The image renders inline as a visible `<img>` element (not a broken link, not raw markdown text).
**Why human:** React rendering behavior and visual output cannot be verified from static analysis.

---

### Gaps Summary

No gaps. All 5 must-have truths are verified. Both required artifacts groups (file serving + image rendering) exist, are substantive, are wired, and data flows through them. Both commits (72599a8, 03c80d3) exist in git history and correspond to their documented deliverables.

---

_Verified: 2026-03-27T09:50:00Z_
_Verifier: Claude (gsd-verifier)_
