# Roadmap: ai-manager v0.1 Settings

## Overview

This milestone refactors the settings page to deliver three capabilities on top of an already-solid backend: dark/light/system theme switching with no FOUC, live CLI adapter verification with per-check results, and full CRUD for agent prompts. All server actions and adapter test infrastructure exist; the work is primarily UI surfacing with one critical CSS prerequisite fix.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Theme + General Settings** - Fix dark mode CSS, install next-themes, add General settings panel with theme and language toggles (completed 2026-03-26)
- [x] **Phase 2: CLI Adapter Verification** - Add live connection test button to AI Tools settings with per-check pass/fail results (completed 2026-03-26)
- [ ] **Phase 3: Agent Prompt Management** - Full CRUD UI for AgentPrompt with default enforcement in settings

## Phase Details

### Phase 1: Theme + General Settings
**Goal**: Users can control their appearance preferences (theme and language) from a General settings panel that persists across sessions
**Depends on**: Nothing (first phase)
**Requirements**: GNRL-01, GNRL-02, GNRL-03, GNRL-04, GNRL-05
**Success Criteria** (what must be TRUE):
  1. User can open Settings and see a "General" section in the left navigation
  2. User can select dark, light, or system theme and the UI switches immediately with no flash
  3. User's theme choice persists after closing and reopening the browser
  4. When system mode is selected, the UI follows the OS dark/light preference automatically
  5. User can toggle the UI language between Chinese and English from the General panel
**Plans:** 2/2 plans complete
Plans:
- [x] 01-01-PLAN.md — CSS fix + theme infrastructure (next-themes, ThemeProvider, light/dark CSS vars, i18n keys)
- [x] 01-02-PLAN.md — Settings nav restructure + General settings panel (theme toggle, language toggle)
**UI hint**: yes

### Phase 2: CLI Adapter Verification
**Goal**: Users can confirm their AI tool CLI is correctly installed by running a live connection test from the AI Tools settings panel
**Depends on**: Phase 1
**Requirements**: CLIV-01, CLIV-02, CLIV-03, CLIV-04
**Success Criteria** (what must be TRUE):
  1. User can click "Test Connection" for a registered adapter and see a loading state while the test runs
  2. Test results show individual pass/fail status for each check (command found, API key, hello probe) with actionable messages
  3. Test results display the detected CLI version when the command is found
  4. Clicking "Test Connection" a second time while a test is running has no effect (button is disabled)
**Plans:** 2/2 plans complete
Plans:
- [x] 02-01-PLAN.md — Version check backend + i18n keys + test scaffold
- [x] 02-02-PLAN.md — CLIAdapterTester component + settings wiring + visual checkpoint
**UI hint**: yes

### Phase 3: Agent Prompt Management
**Goal**: Users can create, edit, delete, and designate a default agent prompt from a Prompts settings panel
**Depends on**: Phase 2
**Requirements**: PMPT-01, PMPT-02, PMPT-03, PMPT-04, PMPT-05
**Success Criteria** (what must be TRUE):
  1. User can see a "Prompts" section in the settings left navigation and a list of all agent prompts
  2. User can create a new prompt with name, description, and content and it appears in the list immediately
  3. User can edit an existing prompt's name, description, or content and the update is reflected in the list
  4. User can delete a prompt and it is removed from the list (with a confirmation step)
  5. User can mark a prompt as default and only one prompt shows the default indicator at a time
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Theme + General Settings | 2/2 | Complete   | 2026-03-26 |
| 2. CLI Adapter Verification | 2/2 | Complete   | 2026-03-26 |
| 3. Agent Prompt Management | 0/? | Not started | - |
