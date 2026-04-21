# Phase 61: Form UX & UI Polish - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (--auto flag, recommendations accepted)

<domain>
## Phase Boundary

Deliver form interaction fixes for project creation/import/migration dialogs and relocate the assistant icon. Users interact with project forms without confusion between path modes, and the assistant icon is discoverable next to the search box.

</domain>

<decisions>
## Implementation Decisions

### Path Input Modes
- Create project ("新建项目"): Remove browse button, make localPath a plain text Input (editable) — user types path manually after gitUrl auto-resolves it
- Import project ("导入项目"): Keep browse button, make localPath read-only after selection (disable Input or use readOnly prop)
- Migration ("迁移"): Target path field remains editable text Input (already using Input, just ensure not disabled)

### Textarea Overflow
- Apply `max-h-[200px] overflow-y-auto` to all project description and task description textareas
- Use CSS on the textarea element directly (not wrapping div) — prevents dialog from growing beyond viewport
- Applies to: CreateProjectDialog description, ImportProjectDialog description, CreateTaskDialog description

### Path Validation
- Frontend: Show warning label below clone directory input when value starts with `~` — text "请输入绝对路径，不支持 ~ 别名"
- Backend: resolveGitLocalPath action rejects paths starting with ~ and returns validation error
- Only applies to the clone directory setting (not project localPath which is auto-resolved)

### Assistant Icon Relocation
- Move Bot icon from current position (near language toggle/settings) to right side of search box in top-bar
- Keep same icon (Bot from lucide-react), same ghost button style, same click behavior (open assistant panel)
- Position: immediately after the search trigger button, before the settings/language area

### Claude's Discretion
- Exact spacing between search box and assistant icon
- Whether to show tooltip on hover for assistant icon
- Internal refactoring of form state management if needed for cleaner implementation

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/project/create-project-dialog.tsx` — has FolderBrowserDialog integration, gitUrl auto-resolve
- `src/components/project/import-project-dialog.tsx` — has browse, migration toggle, targetPath field
- `src/components/layout/top-bar.tsx` — Bot icon currently rendered near settings area
- `src/components/board/create-task-dialog.tsx` — has description textarea that needs max-height fix
- `src/actions/config-actions.ts` — resolveGitLocalPath action for path resolution

### Established Patterns
- Ghost icon buttons use `h-8 w-8 p-0 text-muted-foreground hover:bg-accent hover:text-foreground`
- All text uses `t("key")` from useI18n() for i18n
- Input component from shadcn, default size h-8

### Integration Points
- `top-bar.tsx` — assistant icon relocation target
- `create-project-dialog.tsx` — remove browse, make path plain text
- `import-project-dialog.tsx` — ensure path read-only after browse
- `config-actions.ts` — add ~ validation on cloneDir

</code_context>

<specifics>
## Specific Ideas

- User explicitly stated: "创建项目的时候，不要 browse 按钮，path 是纯文本输入，可以编辑。导入项目是 browse 选择路径，然后路径不能改"
- User stated: "textarea 输入框要有最大高度啊，超出滚动啊，目前创建任务和项目描述好像没有，导致弹窗高度超标"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
