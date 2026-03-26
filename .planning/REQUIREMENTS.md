# Requirements: ai-manager

**Defined:** 2026-03-26
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## v0.1 Requirements

Requirements for Settings milestone. Each maps to roadmap phases.

### General Settings

- [ ] **GNRL-01**: User can switch between dark, light, and system theme modes
- [ ] **GNRL-02**: User's theme preference persists across browser sessions
- [ ] **GNRL-03**: System theme mode automatically follows OS dark/light preference
- [ ] **GNRL-04**: User can switch UI language between Chinese and English
- [ ] **GNRL-05**: Settings page has restructured left navigation with General, AI Tools, and Prompts sections

### CLI Verification

- [ ] **CLIV-01**: User can trigger a live connection test for each registered AI adapter
- [ ] **CLIV-02**: Test results show per-check pass/fail status with actionable messages
- [ ] **CLIV-03**: Test results show CLI version information when available
- [ ] **CLIV-04**: Test button is debounced to prevent concurrent 45-second test probes

### Agent Prompts

- [ ] **PMPT-01**: User can create a new agent prompt with name, description, and content
- [ ] **PMPT-02**: User can edit an existing agent prompt
- [ ] **PMPT-03**: User can delete an agent prompt
- [ ] **PMPT-04**: User can set a prompt as default
- [ ] **PMPT-05**: Prompt list displays all prompts with name, description, and default indicator

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
| GNRL-01 | Pending | Pending |
| GNRL-02 | Pending | Pending |
| GNRL-03 | Pending | Pending |
| GNRL-04 | Pending | Pending |
| GNRL-05 | Pending | Pending |
| CLIV-01 | Pending | Pending |
| CLIV-02 | Pending | Pending |
| CLIV-03 | Pending | Pending |
| CLIV-04 | Pending | Pending |
| PMPT-01 | Pending | Pending |
| PMPT-02 | Pending | Pending |
| PMPT-03 | Pending | Pending |
| PMPT-04 | Pending | Pending |
| PMPT-05 | Pending | Pending |

**Coverage:**
- v0.1 requirements: 14 total
- Mapped to phases: 0
- Unmapped: 14

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after initial definition*
