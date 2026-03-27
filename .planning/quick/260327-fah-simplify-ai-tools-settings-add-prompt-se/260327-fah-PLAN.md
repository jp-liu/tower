---
phase: quick
plan: 260327-fah
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/settings/ai-tools-config.tsx
  - src/app/settings/page.tsx
  - src/components/task/task-detail-panel.tsx
  - src/components/task/task-message-input.tsx
autonomous: true
must_haves:
  truths:
    - "AI Tools settings page shows only CLI verification and a simple default CLI selector"
    - "Complex AgentConfig editing UI (JSON editor, append prompt textarea, config mode toggle) is removed"
    - "Task detail panel shows a prompt template dropdown selector"
    - "Selected prompt content is prepended to the user message when sending"
  artifacts:
    - path: "src/components/settings/ai-tools-config.tsx"
      provides: "Simplified AI tools config with only default CLI selector"
    - path: "src/app/settings/page.tsx"
      provides: "Simplified settings page without AgentConfig CRUD handlers"
    - path: "src/components/task/task-detail-panel.tsx"
      provides: "Task detail panel with prompt selector state"
    - path: "src/components/task/task-message-input.tsx"
      provides: "Message input with prompt dropdown"
  key_links:
    - from: "src/components/task/task-message-input.tsx"
      to: "src/actions/prompt-actions.ts"
      via: "getPrompts() called to populate dropdown"
      pattern: "getPrompts"
---

<objective>
Simplify the AI Tools settings page and add a prompt template selector to the task detail panel.

Purpose: The current AI Tools config has complex AgentConfig editing UI that contradicts the project philosophy (local CLI manages everything, ai-manager just provides optional prompt + calls CLI). The prompt selector in the task panel lets users choose which prompt template to use before sending a message.

Output: Simplified settings page, prompt dropdown in task panel message input area.
</objective>

<context>
@src/components/settings/ai-tools-config.tsx
@src/app/settings/page.tsx
@src/components/task/task-detail-panel.tsx
@src/components/task/task-message-input.tsx
@src/actions/prompt-actions.ts
@src/components/settings/cli-adapter-tester.tsx

<interfaces>
From src/actions/prompt-actions.ts:
```typescript
export async function getPrompts(workspaceId?: string): Promise<AgentPrompt[]>
// AgentPrompt has: id, name, description, content, isDefault, workspaceId
```

From src/components/task/task-message-input.tsx:
```typescript
interface TaskMessageInputProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
  fileChanges?: { added: number; removed: number };
  agentName?: string;
}
```

From src/components/task/task-detail-panel.tsx:
```typescript
interface TaskDetailPanelProps {
  task: Task;
  onClose: () => void;
  onSendMessage: (taskId: string, message: string) => Promise<unknown>;
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Simplify AI Tools settings page</name>
  <files>src/components/settings/ai-tools-config.tsx, src/app/settings/page.tsx</files>
  <action>
**src/components/settings/ai-tools-config.tsx** — Gut the entire component and replace with a minimal version:
- Remove ALL props (configs, onSave, onUpdateConfig, onDeleteConfig)
- Remove the AgentConfig editing section entirely (the second Card with JSON/form toggle, agent+config selectors, append prompt textarea)
- Remove the complex header Card with the two info mini-cards
- Keep ONLY a simple "Default CLI Adapter" selector section:
  - Section header with Settings2 icon, title "Default CLI Adapter" (or Chinese equivalent matching existing style), subtitle
  - A single Select dropdown with hardcoded CLI adapter options: `[{ value: "claude_code", label: "Claude Code" }]` (extensible later)
  - The selected value should be stored in localStorage key `ai-manager:default-cli-adapter` (no DB persistence needed — this is a local preference)
  - Initialize from localStorage on mount, save on change
- Remove imports: Textarea, Separator, Trash2, Shield (no longer needed)
- The component becomes a self-contained zero-prop component: `export function AIToolsConfig()`

**src/app/settings/page.tsx** — Simplify the parent page:
- Remove ALL AgentConfig state (`configs`, `handleSave`, `handleUpdateConfig`, `handleDeleteConfig`)
- Remove the `useEffect` that calls `getAgentConfigs()`
- Remove imports: `getAgentConfigs`, `updateAgentConfig`, `deleteAgentConfig`, the `Prisma` type, the `AgentConfig` interface
- Remove `useRouter` and `router` (no longer needed for refresh after config changes; close handler can use window.history.back())
- Actually keep useRouter for handleClose — it uses `router.back()`
- In the ai-tools section, render `<AIToolsConfig />` with no props, followed by `<CLIAdapterTester>` as before
  </action>
  <verify>
    <automated>cd /Users/liujunping/project/i/ai-manager && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Settings page loads without errors. AI Tools section shows only a default CLI selector and the CLI verification tester. No AgentConfig editing UI visible.</done>
</task>

<task type="auto">
  <name>Task 2: Add prompt template selector to task message input</name>
  <files>src/components/task/task-message-input.tsx, src/components/task/task-detail-panel.tsx</files>
  <action>
**src/components/task/task-message-input.tsx** — Add a prompt template dropdown:
- Add new prop `selectedPromptId?: string | null` and `onPromptChange?: (promptId: string | null) => void` and `prompts?: Array<{ id: string; name: string; isDefault: boolean }>` to TaskMessageInputProps
- In the toolbar row (next to the mode dropdown, before the attach/tool buttons), add a prompt selector dropdown:
  - Use the existing DropdownMenu component pattern already in the file
  - Show a FileText icon (from lucide-react) + the selected prompt name (or "No Prompt" if none selected)
  - Dropdown items: "No Prompt" option (sets null) + all prompts from the `prompts` prop
  - Default prompts should show a small star icon or "(default)" suffix
  - Style consistently with the existing mode selector button (same text-[11px], border, bg-muted/50 pattern)
- When `handleSend` fires and a prompt is selected, prepend the prompt content to the message. But wait — the component only has prompt id/name, not content. Two options:
  - Option A: Add `promptContent` to the prompts array prop
  - Option B: Let the parent handle prepending
  - Go with Option A: extend the prompts prop to `Array<{ id: string; name: string; content: string; isDefault: boolean }>`
  - In `handleSend`, if selectedPromptId is set and a matching prompt exists, call `onSend` with `[PROMPT: promptName]\n${promptContent}\n\n---\n\n${userMessage}` format
  - Actually simpler: just pass the prompt content as a prefix. Format: `${promptContent}\n\n${userMessage}`

**src/components/task/task-detail-panel.tsx** — Wire prompt data:
- Import `getPrompts` from `@/actions/prompt-actions`
- Add state: `const [prompts, setPrompts] = useState<Array<{ id: string; name: string; content: string; isDefault: boolean }>>([])`
- Add state: `const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)`
- In the existing `useEffect` (or a new one), call `getPrompts()` and map to the simplified shape. Set `selectedPromptId` to the default prompt's id if one exists.
- Pass `prompts`, `selectedPromptId`, and `onPromptChange={setSelectedPromptId}` to `<TaskMessageInput>`
  </action>
  <verify>
    <automated>cd /Users/liujunping/project/i/ai-manager && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Task detail panel shows a prompt dropdown in the message input area. User can select a prompt template. When sending a message with a prompt selected, the prompt content is prepended to the message. Default prompt is auto-selected on panel open.</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. Settings page > AI Tools section shows only CLI selector + CLI tester (no AgentConfig editor)
3. Kanban board > click a task > task detail panel shows prompt dropdown in message input toolbar
4. Selecting a prompt and sending a message includes prompt content in the sent message
</verification>

<success_criteria>
- AI Tools settings page is visually simplified: only default CLI selector + CLI verification
- All AgentConfig editing UI (JSON editor, append prompt, config mode toggle) is removed from the settings page
- Task detail panel message input has a working prompt template dropdown
- Default prompt is auto-selected when opening a task panel
- TypeScript compiles without errors
</success_criteria>

<output>
After completion, create `.planning/quick/260327-fah-simplify-ai-tools-settings-add-prompt-se/260327-fah-SUMMARY.md`
</output>
