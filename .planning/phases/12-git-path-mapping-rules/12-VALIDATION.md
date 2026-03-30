---
phase: 12
slug: git-path-mapping-rules
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run tests/unit/actions/config-actions.test.ts tests/unit/lib/git-url.test.ts` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | GIT-01 | unit | `pnpm vitest run tests/unit/lib/git-url.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | GIT-01, GIT-02 | unit | `pnpm vitest run tests/unit/actions/config-actions.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/lib/git-url.test.ts` — stubs for matchGitPathRule and resolveGitLocalPath
- [ ] Existing config-actions tests remain green after adding resolveGitLocalPath

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Rules CRUD in settings UI | GIT-01 | Visual UI + user interaction | Navigate to Settings > Config, add/edit/delete rules, verify persistence |
| Auto-populate on Git URL entry | GIT-02 | Visual UI + async behavior | Create project, enter Git URL, verify localPath auto-fills |
| Rules persist across page reload | GIT-01 | Browser state | Add rules, refresh page, verify rules still visible |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
