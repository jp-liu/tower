# Phase 39: Polish & Settings - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning
**Mode:** Smart discuss (--auto, all recommended accepted)

<domain>
## Phase Boundary

The assistant experience is configurable, fully bilingual, and works well at all viewport sizes. Users can switch between terminal mode and chat mode via Settings. All assistant UI text is available in both Chinese and English. Both sidebar and dialog modes render correctly on viewports from 1024px to 2560px wide.

</domain>

<decisions>
## Implementation Decisions

### Settings UI
- Add a "Communication Mode" select in Settings > General section allowing users to switch between "Terminal" and "Chat" mode
- The select updates the `assistant.communicationMode` config key in SystemConfig
- The setting takes effect immediately (no restart needed) — the next time the assistant panel is opened, it uses the new mode
- Follow the existing Settings pattern in `system-config.tsx` for the select implementation

### i18n Migration
- Add all `assistant.*` i18n keys to `src/lib/i18n.tsx` in both `zh` and `en` locales
- Replace all hardcoded English strings in assistant components with `t("assistant.*")` calls
- Keys to add: assistant.title, assistant.iconLabel, assistant.starting, assistant.errorTitle, assistant.errorBody, assistant.emptyTitle, assistant.emptyBody, assistant.inputPlaceholder, assistant.sendLabel, assistant.thinking, assistant.toolLabel, assistant.parseError, assistant.parseErrorBody
- Follow the existing i18n pattern: `useI18n()` hook with `t("key")`

### Responsive Sizing
- Sidebar mode: use `min-w-[320px] max-w-[480px] w-[30vw]` instead of fixed 420px — adapts to viewport while maintaining readable width
- Dialog mode: use `max-w-[600px] w-[90vw]` for responsive modal width
- Both modes should render correctly on viewports from 1024px (laptop) to 2560px (ultrawide)
- No overflow or truncation of content at any viewport size

### Claude's Discretion
- Exact responsive breakpoint behavior
- Whether to add min/max constraints on dialog height
- Settings section ordering (where Communication Mode appears relative to other settings)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/settings/system-config.tsx` — Settings page with config key management
- `src/lib/i18n.tsx` — i18n dictionary with `zh` and `en` locales
- `src/components/assistant/assistant-provider.tsx` — reads config on mount
- `src/components/assistant/assistant-panel.tsx` — panel container with 420px width
- `src/components/assistant/assistant-chat.tsx` — chat UI with hardcoded strings
- `src/components/assistant/assistant-chat-bubble.tsx` — bubble rendering with hardcoded strings

### Established Patterns
- `getConfigValue` / `setConfigValue` for SystemConfig CRUD
- `useI18n()` hook returning `{ t, locale, setLocale }`
- Select component pattern per `.claude/rules/ui.md`

### Integration Points
- Settings page: Add communication mode select to system-config.tsx
- i18n: Add keys to i18n.tsx, replace hardcoded strings in all assistant components
- Responsive: Modify assistant-panel.tsx sidebar width class

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond what's in the ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — this is the final phase of the milestone.

</deferred>
