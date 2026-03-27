# Requirements: ai-manager

**Defined:** 2026-03-26
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## v0.1 Requirements

Requirements for Settings milestone. Each maps to roadmap phases.

### General Settings

- [x] **GNRL-01**: User can switch between dark, light, and system theme modes
- [x] **GNRL-02**: User's theme preference persists across browser sessions
- [x] **GNRL-03**: System theme mode automatically follows OS dark/light preference
- [x] **GNRL-04**: User can switch UI language between Chinese and English
- [x] **GNRL-05**: Settings page has restructured left navigation with General, AI Tools, and Prompts sections

### CLI Verification

- [x] **CLIV-01**: User can trigger a live connection test for each registered AI adapter
- [x] **CLIV-02**: Test results show per-check pass/fail status with actionable messages
- [x] **CLIV-03**: Test results show CLI version information when available
- [x] **CLIV-04**: Test button is debounced to prevent concurrent 45-second test probes

### Agent Prompts

- [x] **PMPT-01**: User can create a new agent prompt with name, description, and content
- [x] **PMPT-02**: User can edit an existing agent prompt
- [x] **PMPT-03**: User can delete an agent prompt
- [x] **PMPT-04**: User can set a prompt as default
- [x] **PMPT-05**: Prompt list displays all prompts with name, description, and default indicator

## Future Requirements

### Task-Prompt Integration

- **TASK-01**: User can select agent prompt when creating a task
- **TASK-02**: Task card shows assigned prompt indicator

## Out of Scope

| Feature | Reason |
|---------|--------|
| Workspace-scoped prompt filtering in settings | Settings is global; workspace filtering deferred to task creation |
| Skills configuration | Placeholder exists; separate milestone |
| Plugins/MCP configuration | Placeholder exists; separate milestone |
| Prompt preview/test execution | Nice-to-have; not needed for v0.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GNRL-01 | Phase 1 | Complete |
| GNRL-02 | Phase 1 | Complete |
| GNRL-03 | Phase 1 | Complete |
| GNRL-04 | Phase 1 | Complete |
| GNRL-05 | Phase 1 | Complete |
| CLIV-01 | Phase 2 | Complete |
| CLIV-02 | Phase 2 | Complete |
| CLIV-03 | Phase 2 | Complete |
| CLIV-04 | Phase 2 | Complete |
| PMPT-01 | Phase 3 | Complete |
| PMPT-02 | Phase 3 | Complete |
| PMPT-03 | Phase 3 | Complete |
| PMPT-04 | Phase 3 | Complete |
| PMPT-05 | Phase 3 | Complete |

**Coverage:**
- v0.1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after roadmap creation*
