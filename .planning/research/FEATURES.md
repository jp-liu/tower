# Feature Research

**Domain:** Task development workbench — online code editor, file tree browser, diff view, live preview
**Researched:** 2026-03-31
**Confidence:** HIGH (editor/diff/file tree), MEDIUM (preview — proxy implementation details depend on local environment)

---

## Scope

This document covers ONLY the new v0.6 features: (1) online code editor, (2) file tree browser, (3) diff view panel, (4) live preview panel. Existing shipped features (Kanban board, AI chat, SSE streaming, git worktree, diff/merge dialog) are treated as dependencies, not subjects of research.

---

## Feature Landscape

### Category 1: Online Code Editor

#### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Syntax highlighting | Every code editor has this; absence is jarring | LOW | Monaco gives this for free across 80+ languages |
| Line numbers | Universal expectation from any code view | LOW | Monaco default |
| Read file from disk and display | Core function — open a file and see it | LOW | Server Action reads file via Node `fs.readFile`; path must be validated against worktree root |
| Save file to disk on explicit action | Users expect Ctrl+S / save button | LOW | Server Action writes file; must validate path stays within worktree (no path traversal) |
| Correct language detection per file extension | `.ts` → TypeScript, `.py` → Python | LOW | Monaco detects via URI extension |
| Cursor position / line:col indicator | Status bar expectation from VS Code | LOW | Monaco exposes this via editor model |
| Basic keyboard shortcuts (Ctrl+Z undo, Ctrl+F find, etc.) | Users muscle-memory from VS Code | LOW | Monaco bundles these |
| Unsaved-changes indicator | Prevent accidental tab close losing work | MEDIUM | Track editor dirty state; show dot in tab label |
| Tab-based multi-file editing | Users want multiple open files without losing context | MEDIUM | Need tab state management; Monaco supports multiple models |

#### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| TypeScript / LSP IntelliSense | Context-aware completion feels like VS Code | HIGH | Monaco ships TypeScript language service; enabling it for project node_modules requires worker config and tsconfig loading |
| AI inline suggestions keyed to task context | Agent has already been working on this code; inline hints from chat history | HIGH | Requires custom Monaco completion provider wired to task messages |
| Jump-to-definition within the worktree | Feels like a real IDE | HIGH | Requires language server or Monaco's built-in TS service with project file loading |
| Auto-format on save (Prettier / ESLint) | DX expectation for JS/TS projects | MEDIUM | Call `prettier --write` via Server Action on save; surface errors inline |
| Editor theme matching app theme | Dark/light consistency with the rest of ai-manager | LOW | Monaco ships light/dark themes; wire to next-themes signal |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full terminal emulator in editor | Developers want "run commands" | xterm.js + PTY is a significant scope addition; scope creep for v0.6 | The AI chat panel already drives Claude CLI execution; use that for commands |
| Real-time multi-cursor collaboration | Sounds modern | Single-user local tool by design; adds websocket complexity for zero benefit | Not applicable |
| Auto-save on every keystroke | Prevents data loss | Triggers server writes hundreds of times per minute; races with Claude CLI writes to same file | Explicit save (Ctrl+S) + unsaved-changes indicator |
| File creation / rename / delete from editor | Power users want full IDE | Scope belongs in file tree context menu, not the editor itself | Implement in file tree category |

---

### Category 2: File Tree Browser

#### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Display directory structure of worktree root | Core function; absence means cannot navigate project | LOW | Server Action reads directory recursively via `fs.readdir`; scope is worktree path from `TaskExecution.worktreePath` |
| Expand/collapse folders | Navigating nested directories is universal | LOW | Component state; lazy load children on expand |
| File icons by type | Visual differentiation; VS Code / bolt.new standard | LOW | `react-icons` or vscode-icons dataset |
| Click to open file in editor | Primary interaction | LOW | Pass selected file path to editor component |
| Highlight currently open file | Show where you are | LOW | Match active editor path against tree node |
| Right-click context menu with relevant actions | VS Code / JetBrains user muscle memory | MEDIUM | "Open", "Copy path" are minimum; "New file", "Delete" are additions |
| Gitignore-aware filtering | Developers do not want to see `node_modules/` in file tree | MEDIUM | Read `.gitignore` from worktree root; filter entries; `ignore` npm package handles patterns |
| Tree auto-refresh when Claude CLI modifies files | Claude writes files; tree must stay current | MEDIUM | Poll via setInterval (1-2 s) or use `fs.watch` streamed through SSE; polling is simpler and sufficient |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Visual diff indicators on file tree nodes | Show modified / added / deleted files at a glance (like VS Code Source Control decorations) | MEDIUM | Derive from `git diff --name-status` against base branch; annotate file nodes with M/A/D badges |
| New file / new folder via context menu or button | Power users want full control without switching to terminal | MEDIUM | Server Action: `fs.mkdir` / `fs.writeFile`; validate path stays in worktree |
| Rename / delete via context menu | Same expectation | MEDIUM | Server Action: `fs.rename` / `fs.rm`; guard against deleting `.git/` |
| Search files by name (fuzzy) | Large projects have hundreds of files | MEDIUM | Client-side fuzzy filter over flattened file list |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full file manager (cut/copy/paste across worktrees) | Power user appeal | Worktrees are isolated by design; cross-worktree ops risk corruption | Single-worktree scope only |
| Drag-and-drop file move | VS Code does it | Complex edge cases (cross-directory moves, git tracking) for v0.6 | Defer to v0.7; context menu rename covers 90% of needs |
| Show all workspace projects in one tree | Unified view sounds useful | Violates task isolation — each task has its own worktree | Scope tree to current task worktree only |

---

### Category 3: Diff View Panel

#### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Show unified diff of all changes vs base branch | Core purpose of the panel | LOW | `git diff <baseBranch>...<taskBranch>` — already used in v0.5 merge flow |
| Syntax-highlighted diff lines | Red/green coloring is universal diff expectation | LOW | `diff2html` or `react-diff-view` renders colored diffs from unified diff text |
| File-by-file navigation | Large diffs span many files; jumping by file is critical | LOW | Parse diff into file sections; render file headers as anchors or list |
| Line numbers for each hunk | Context for where change is in the file | LOW | Included in unified diff output; rendered by diff libraries |
| Summary header (N files changed, N insertions, N deletions) | GitHub / GitLab standard; immediate context | LOW | Parse from `git diff --stat` |
| Toggle between unified and split (side-by-side) view | Users have strong preference; GitHub offers both | MEDIUM | `react-diff-view` supports both modes; `git-diff-view` is an alternative |
| Refresh/reload diff | Claude may have made more changes since diff was last shown | LOW | Button triggers re-run of `git diff` |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-file collapse/expand | Long diffs become unreadable; file-level folding restores clarity | LOW | CSS show/hide; no library change needed |
| Whitespace change toggle (ignore / show) | Formatting-only changes distract from logic changes | LOW | `git diff --ignore-space-change` flag |
| Inline comment anchoring (select lines to comment) | Code review workflow without leaving the workbench | HIGH | Requires comment storage model; defer to post-v0.6 |
| Merge conflict view | Show conflicts when Claude's branch diverges | HIGH | Different problem domain; defer |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Editable diff view (edit code inside the diff) | Power appeal | Merging editor state with diff state is complex; creates ambiguity about what gets saved | Open file in editor tab for editing; diff is read-only review |
| Commit-level diff navigation (browse individual commits) | Git history exploration | Out of scope for task workbench; task branch is a single unit of work | Full git history is for separate tooling |
| Diff between arbitrary branches | Flexible but vague | Scope should be fixed: task branch vs base branch | The fixed comparison is the value; keep it simple |

---

### Category 4: Live Preview Panel

#### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Configurable start command per project | Projects vary: `npm run dev`, `python -m flask run`, etc. | MEDIUM | Store `previewCommand` + `previewPort` on Project; spawn child process via Server Action |
| Show running / stopped / error status | User needs feedback that the preview server started | LOW | Track process state; surface in panel header |
| iframe embedding of localhost:PORT | The actual preview window | MEDIUM | `<iframe src="http://localhost:{port}" />` works for same-machine local tool; HTTPS not required since ai-manager is localhost-only |
| Start / stop controls | Manual lifecycle management | LOW | Button triggers Server Action to spawn / kill process |
| Error log display when start command fails | Process crash output is critical for debugging | MEDIUM | Capture stderr/stdout from child process; display in panel below iframe |
| Reload button | Force refresh the iframe after Claude makes changes | LOW | `iframeRef.current.src = iframeRef.current.src` |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-reload on file save | Developer ergonomics; bolt.new / StackBlitz do this | MEDIUM | Watch for file-save events (already happening via editor save); reload iframe on save callback |
| Process output live tail | See `vite` output, errors, HMR messages in real time | MEDIUM | SSE stream from child process stdout; reuse existing SSE infrastructure from agent execution |
| Resize handle between preview and other panels | UX comfort for different project types | LOW | CSS flex resize or `react-resizable-panels` |
| Multiple preview commands (e.g., Storybook + app) | Complex projects have multiple servers | HIGH | Defer to post-v0.6; single preview covers 90% |
| Mobile viewport emulation (resize to phone dimensions) | Design review use case | LOW | CSS `width` + `height` selector on iframe wrapper; no iframe API needed |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| WebContainer in-browser execution (like StackBlitz) | No external server needed | Requires Service Worker + WebAssembly Node.js runtime; massive complexity; ai-manager runs on localhost with Node already available | Use native child_process to spawn real dev server |
| Automatic port detection | Less config for user | Port conflicts are silent and confusing; wrong port silently shows wrong content | Require explicit port config; auto-suggest from common defaults (3000, 5173, 8080) |
| OAuth / cookie passthrough in iframe | Some dev servers need auth | Same-origin complications; CSP issues; out of scope for localhost tool | Document workaround: open in browser tab |
| Preview for non-web projects (CLI tools, APIs) | Completeness | iframe is a browser; non-HTTP output has no natural preview | Show process output log only; no iframe for non-web projects |

---

## Feature Dependencies

```
[File Tree Browser]
    └──requires──> [Server Action: fs read directory (scoped to worktree)]
                       └──requires──> [TaskExecution.worktreePath (v0.5 shipped)]

[Online Code Editor]
    └──requires──> [File Tree Browser] (click to open file)
    └──requires──> [Server Action: fs read file / write file (path-validated)]

[Diff View Panel]
    └──requires──> [TaskExecution.worktreeBranch + Task.baseBranch (v0.5 shipped)]
    └──shares──> [git diff logic (v0.5 merge dialog already calls this)]

[Live Preview Panel]
    └──requires──> [Project.previewCommand + Project.previewPort (new schema fields)]
    └──requires──> [Child process management (new server-side capability)]
    └──enhances──> [Online Code Editor: auto-reload on save]

[Git diff indicators on file tree]
    └──requires──> [Diff View Panel: git diff --name-status output]
    └──enhances──> [File Tree Browser]

[Unsaved-changes indicator in editor]
    └──requires──> [Online Code Editor tab state]
    └──enhances──> [Live Preview: know when to auto-reload]
```

### Dependency Notes

- **File tree requires worktreePath**: `TaskExecution.worktreePath` is the root for all fs operations in the workbench. This was shipped in v0.5. All file reads/writes must be validated against this path to prevent traversal attacks.
- **Diff view reuses v0.5 work**: The v0.5 diff/merge dialog already calls `git diff`. The diff panel reuses the same git diff output; new work is the rendering library and panel UI, not the diff computation itself.
- **Preview requires new schema fields**: `previewCommand` and `previewPort` are not in the current Project model. This is a new schema migration needed before Preview can work.
- **Child process management is new scope**: The existing SSE streaming is for Claude CLI. Preview panel needs a separate child_process lifecycle — spawn, monitor, stream stdout, kill. This is a distinct new capability with no current equivalent in the codebase.
- **Editor auto-reload enhances preview**: If Preview auto-reload is implemented, it depends on an explicit save event from the editor (not auto-save). This creates a clean integration point without tight coupling.

---

## MVP Definition

### Launch With (v0.6)

Minimum viable workbench — enough to replace context-switching between the app and a local file explorer/terminal.

**Editor:**
- [ ] Monaco Editor (`@monaco-editor/react`) with syntax highlighting — core value of an online editor
- [ ] Read file on tree click, display with line numbers — cannot edit what you cannot see
- [ ] Ctrl+S save with Server Action path-validated write — editor is useless without save
- [ ] Unsaved-changes dot indicator in tab — prevents data loss
- [ ] Tab-based multi-file editing (2-3 tabs minimum) — single-file view requires constant re-opening

**File Tree:**
- [ ] Directory listing scoped to `TaskExecution.worktreePath` — navigation foundation
- [ ] Expand/collapse folders, file icons by extension — visual orientation
- [ ] Click to open in editor — primary interaction
- [ ] Gitignore-aware filtering (hide `node_modules/`, `.git/`) — unusable noise without this
- [ ] Auto-refresh every 2s when task execution is RUNNING — Claude modifies files; stale tree breaks context

**Diff View:**
- [ ] Unified diff against base branch rendered via `react-diff-view` or `diff2html` — core review workflow
- [ ] File-by-file sections with summary header — orientation in large diffs
- [ ] Reload button — Claude keeps changing code; diff must be refreshable
- [ ] Toggle unified/split — strong user preference

**Preview:**
- [ ] Configurable `previewCommand` + `previewPort` on Project (new schema fields) — no preview without config
- [ ] Start/stop child process, status indicator — lifecycle control
- [ ] iframe embed of localhost:PORT — the actual preview
- [ ] Process error output displayed below iframe — debugging failed starts

### Add After Validation (v0.6.x)

- [ ] Git diff status indicators on file tree nodes — trigger: users ask "which files did Claude change?"
- [ ] Auto-reload preview on editor save — trigger: manual reload friction observed
- [ ] SSE-streamed process stdout in preview panel — trigger: HMR output visibility requested
- [ ] New file / new folder / rename / delete from file tree context menu — trigger: users want to scaffold files without switching to terminal
- [ ] Whitespace ignore toggle in diff view — trigger: formatting-heavy diffs reported as noise
- [ ] Auto-format on save (Prettier) — trigger: TypeScript projects have strong expectation

### Future Consideration (v0.7+)

- [ ] TypeScript IntelliSense / LSP — defer: Monaco TS service requires project tsconfig loading and worker configuration; high complexity
- [ ] AI inline suggestions wired to task chat — defer: requires custom completion provider and message indexing
- [ ] Mobile viewport emulation in preview — defer: low priority for a localhost dev tool
- [ ] Multiple preview commands per project — defer: single preview covers the common case
- [ ] Inline comment anchoring in diff — defer: requires new data model; review workflow is post-MVP

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Monaco Editor with syntax highlight + save | HIGH | LOW | P1 |
| File tree with gitignore filtering | HIGH | MEDIUM | P1 |
| Unified diff view (react-diff-view) | HIGH | LOW | P1 |
| Multi-file tabs in editor | HIGH | MEDIUM | P1 |
| Preview panel start/stop + iframe | HIGH | MEDIUM | P1 |
| Auto-refresh file tree during execution | HIGH | LOW | P1 |
| Split diff view toggle | MEDIUM | LOW | P2 |
| Git diff badges on file tree nodes | MEDIUM | MEDIUM | P2 |
| SSE stdout stream for preview | MEDIUM | MEDIUM | P2 |
| Auto-reload preview on save | MEDIUM | LOW | P2 |
| File create/rename/delete in tree | MEDIUM | MEDIUM | P2 |
| Auto-format on save (Prettier) | MEDIUM | LOW | P2 |
| TypeScript IntelliSense | HIGH | HIGH | P3 |
| AI inline suggestions | HIGH | HIGH | P3 |
| Inline diff comments | MEDIUM | HIGH | P3 |
| Multiple preview commands | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v0.6 launch
- P2: Should have, add in v0.6.x patch
- P3: Future milestone consideration

---

## Competitor Feature Analysis

| Feature | bolt.new | v0.dev | Cursor | Our Approach |
|---------|----------|--------|--------|--------------|
| Code editor | Monaco (full IDE) | Monaco (read/edit) | VS Code fork | Monaco via @monaco-editor/react |
| File tree | Full project tree, context menu CRUD | Simplified tree | Full VS Code explorer | Worktree-scoped tree, gitignore-aware |
| Diff view | Inline diff in chat messages | Inline preview | Dedicated diff panel with split view | Dedicated panel, reuses v0.5 git diff |
| Live preview | WebContainer in-browser (no external server) | Vercel deploy preview | External browser / browser preview extension | localhost child_process + iframe (simpler, viable since localhost-only) |
| AI chat | Full-width chat drives everything | Prompt then generate | Chat panel + composer | Existing SSE chat; workbench is right panel |
| Multi-agent | Not yet | No | Background agents (2025) | Each task = one worktree = one agent (v0.5 foundation) |
| Auto-reload | Yes, on WebContainer change | Yes | Yes (HMR passthrough) | File save triggers iframe reload (simple, sufficient) |

**Key insight:** bolt.new uses WebContainers (Service Worker + WASM Node.js) to avoid needing an external dev server. That technology is not warranted for ai-manager because the app is localhost-only and Node is already running on the machine. A plain `child_process.spawn` is simpler, more reliable, and gives the same UX result for zero additional infrastructure.

---

## Sources

- [bolt.new GitHub (StackBlitz)](https://github.com/stackblitz/bolt.new) — feature reference for agentic workbench UX
- [RedMonk: 10 Things Developers Want from Agentic IDEs 2025](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/) — developer expectation research
- [Builder.io: Best Agentic IDEs heading into 2026](https://www.builder.io/blog/agentic-ide) — UX patterns and feature convergence
- [@monaco-editor/react npm](https://www.npmjs.com/package/@monaco-editor/react) — 380k weekly downloads, no webpack config needed
- [Sourcegraph: Migrating Monaco to CodeMirror](https://sourcegraph.com/blog/migrating-monaco-codemirror) — Monaco vs CodeMirror tradeoff analysis
- [react-diff-view npm](https://www.npmjs.com/package/react-diff-view) — git diff rendering component for React
- [git-diff-view GitHub](https://github.com/MrWangJustToDo/git-diff-view) — alternative diff viewer (React/Vue/Solid/Svelte/Ink)
- [diff2html](https://diff2html.xyz/) — alternative diff renderer, simpler API
- [MDN: iframe sandbox directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) — preview panel security considerations
- [Zed: Split Diffs blog post](https://zed.dev/blog/split-diffs) — split diff UX patterns, top user request after git integration launch
- [NxCode: V0 vs Bolt.new vs Lovable comparison 2026](https://www.nxcode.io/resources/news/v0-vs-bolt-vs-lovable-ai-app-builder-comparison-2025) — feature-level comparison of workbench tools

---

*Feature research for: ai-manager v0.6 task development workbench*
*Researched: 2026-03-31*
