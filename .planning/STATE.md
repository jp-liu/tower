---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Extensions & Slim Distribution
status: planning
stopped_at: v1.2 requirements + roadmap defined — ready for /gsd:plan-phase 71
last_updated: "2026-05-09T09:00:00.000Z"
last_activity: 2026-05-09
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

ROADMAP: .planning/ROADMAP.md
REQUIREMENTS: .planning/REQUIREMENTS.md
Last shipped: v1.1 (2026-05-08)

**Core value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.
**Current focus:** v1.2 — Extensions & Slim Distribution (Phase 71 next)

## Current Position

Phase: 71 — Extension Detection & Wiring (not started)
Plan: —
Status: Roadmap defined, ready to plan Phase 71
Last activity: 2026-05-09 — v1.2 milestone started

Progress: [░░░░░░░░░░] 0% (0/3 phases)

## Phase Overview

| Phase | Name | Requirements | Status |
|------:|------|--------------|--------|
| 71 | Extension Detection & Wiring | EXT-01..09 | 📋 Not started |
| 72 | Extensions Settings Tab | SETTING-EXT-01..04 | 📋 Not started |
| 73 | Onboarding Integration | ONBD-EXT-01..05 | 📋 Not started |

## Milestone History

| Milestone | Phases | Status |
|-----------|-------:|--------|
| v0.1 — v0.97 | 1-64 | ✅ shipped (see ROADMAP) |
| v1.0 — 首次使用引导 & 任务完成通知 | 65-68 | ✅ shipped 2026-04-23 |
| v1.1 — Detail Page Reliability & Discovery | 69-70 | ✅ shipped 2026-05-08 |
| v1.2 — Extensions & Slim Distribution | 71-73 | 🚧 in planning |

## Accumulated Context

### Decisions

- v1.0 milestone artifacts kept local-only — `.planning/` is gitignored since `dbaf04d` (2026-04-22)
- Only `.planning/ROADMAP.md` and `.planning/STATE.md` are git-tracked
- v1.1 splits stability (Phase 69) from discovery/UX (Phase 70) — easy to parallelize and verify independently
- v1.2 unifies rg + Monaco install/check into a single `Extension` registry (not a real plugin system, just a shared abstraction)
- v1.2 install strategy for rg: `pnpm add @vscode/ripgrep` (no sudo, package binary at `node_modules/.../bin/rg`); detection dual-track (package binary first, then `which rg` fallback for users with system rg)
- v1.2 install strategy for Monaco: `pnpm add monaco-editor` + run `scripts/copy-monaco.js` to copy `min/vs` → `public/vs/`; `package.json` postinstall no longer auto-runs the copy
- v1.2 unset扩展 → 完全不渲染对应 tab（Phase 71 EXT-07）；不在 tab 里显示 inline install 提示
- v1.2 Onboarding 默认勾上扩展，未勾给"以后可在 Settings 启用"hint；Settings → Extensions tab 是任意时刻的入口
- v1.2 install/uninstall 不需要重启 Tower；hook 缓存 invalidate + getRgPath cache 清空 + Next 静态路由热加载 public/vs
- Build & Distribution slimming（改 monaco-editor 为 optionalDeps、削 npm pack tarball、release-smoke 验证）从 v1.2 推迟，留给单独后续 milestone

### Pending Todos

- Preview 功能需求梳理（前端项目启动 + iframe 预览，独立里程碑）
- Weekly knowledge digest 工具（`.notes/todo-weekly-knowledge-digest.md`）
- v1.3 (provisional): Build & Distribution slimming
- Git robustness（stash / undo / 推送重试 / 冲突标记 / fetch 可见）— 仍待立项，可能与上面合并

### Blockers/Concerns

- 工作区遗留 11 个修改 + 6 个新文件（AI provider / MCP migration），跟 v1.2 无关，但留意冲突点

## Session Continuity

Last session: 2026-05-09T09:00:00.000Z
Stopped at: v1.2 requirements + roadmap defined
Resume file: None
