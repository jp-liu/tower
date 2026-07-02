export interface ConfigEntry {
  defaultValue: unknown;
  type: "string" | "number" | "boolean" | "object";
  label: string;
}

export const CONFIG_DEFAULTS: Record<string, ConfigEntry> = {
  "git.pathMappingRules": {
    defaultValue: [],
    type: "object",
    label: "Git Path Mapping Rules",
  },
  "system.maxUploadBytes": {
    defaultValue: 52428800,
    type: "number",
    label: "Max Upload Size (bytes)",
  },
  "system.maxConcurrentExecutions": {
    defaultValue: 20,
    type: "number",
    label: "Max Concurrent Executions",
  },
  "system.maxReadableFileBytes": {
    defaultValue: 5_242_880,
    type: "number",
    label: "Max Readable File Size (bytes)",
  },
  "system.backupDir": {
    defaultValue: "",
    type: "string",
    label: "Backup Directory",
  },
  "git.timeoutSec": {
    defaultValue: 30,
    type: "number",
    label: "Git Operation Timeout (seconds)",
  },
  "search.resultLimit": {
    defaultValue: 20,
    type: "number",
    label: "Search Result Limit",
  },
  "search.allModeCap": {
    defaultValue: 5,
    type: "number",
    label: "All-Mode Per-Type Cap",
  },
  "search.debounceMs": {
    defaultValue: 250,
    type: "number",
    label: "Search Debounce (ms)",
  },
  "search.snippetLength": {
    defaultValue: 80,
    type: "number",
    label: "Snippet Length (characters)",
  },
  "search.codeTimeoutSec": {
    defaultValue: 30,
    type: "number",
    label: "Code Search Timeout (seconds)",
  },
  "board.archiveDelayDays": {
    defaultValue: 7,
    type: "number",
    label: "Archive Delay (days)",
  },
  "missions.grid.minCols": {
    defaultValue: 1,
    type: "number",
    label: "Grid Min Columns",
  },
  "missions.grid.maxCols": {
    defaultValue: 5,
    type: "number",
    label: "Grid Max Columns",
  },
  "missions.grid.minRows": {
    defaultValue: 1,
    type: "number",
    label: "Grid Min Rows",
  },
  "missions.grid.maxRows": {
    defaultValue: 5,
    type: "number",
    label: "Grid Max Rows",
  },
  "terminal.app": {
    defaultValue: "Terminal",
    type: "string",
    label: "Default Terminal App",
  },
  "editor.command": {
    defaultValue: "",
    type: "string",
    label: "Default Editor Command",
  },
  "terminal.wsPort": {
    defaultValue: 3001,
    type: "number",
    label: "WebSocket Port",
  },
  "terminal.idleTimeoutSec": {
    defaultValue: 180,
    type: "number",
    label: "Idle Timeout (seconds)",
  },
  "terminal.fontSize": {
    defaultValue: 13,
    type: "number",
    label: "Terminal Font Size",
  },
  "terminal.fontFamily": {
    defaultValue: "Menlo, Monaco, 'Courier New', monospace",
    type: "string",
    label: "Terminal Font Family",
  },
  "assistant.systemPrompt": {
    defaultValue: [
      "You are Tower Assistant — the built-in AI operator for the Tower task management platform.",
      "",
      "## Identity",
      "- You are a task management operator, NOT a coding assistant.",
      "- You can ONLY use Tower MCP tools. You CANNOT read files, edit code, run shell commands, or search the web.",
      "- Always respond in the same language the user uses.",
      "",
      "## Capabilities",
      "When users ask what you can do, respond with EXACTLY these 6 groups. Translate to the user's language.",
      "",
      "1. **Workspace & Project** — View, create, update, delete workspaces and projects. Search projects and repositories.",
      "2. **Task Management** — Create tasks (priority, labels, worktree branch isolation, sub-path, auto-start). Move task status (TODO → IN_PROGRESS → IN_REVIEW → DONE / CANCELLED). Update task info and labels.",
      "3. **Execution Monitor** — Start task execution, check execution status, get terminal output, send commands to running terminals.",
      "4. **Daily Report & Todo** — Generate daily work summary (completed + in-progress). View pending task list sorted by priority.",
      "5. **Labels & Notes & Assets** — Manage workspace labels, project notes, and file attachments.",
      "6. **Global Search** — Search tasks, projects, repositories, notes, and assets by keyword.",
      "",
      "Do NOT list any capabilities beyond the above. Do NOT mention code editing, debugging, testing, git operations, or any development capabilities.",
      "",
      "## Scope Boundary",
      "If the user asks you to write code, explain code, debug, search the web, read/write files, or anything outside Tower task management, reply:",
      "\"抱歉，我只能帮你管理工作区、项目和任务。编码、调试等操作请在任务终端中完成。\"",
      "",
      "## 任务来源标注",
      "每次通过 create_task 创建任务时，在 description 末尾追加一段来源标注（与任务终端、飞书的来源规范一致）：",
      "## 来源",
      "Tower Assistant",
    ].join("\n"),
    type: "string",
    label: "Assistant System Prompt",
  },
  "assistant.displayMode": {
    defaultValue: "sidebar",
    type: "string",
    label: "Assistant Display Mode",
  },
  "assistant.communicationMode": {
    defaultValue: "chat",
    type: "string",
    label: "Assistant Communication Mode",
  },
  "task.defaultUseWorktree": {
    defaultValue: true,
    type: "boolean",
    label: "Default: Use Worktree",
  },
  "task.defaultAutoStart": {
    defaultValue: false,
    type: "boolean",
    label: "Default: Auto-start Execution",
  },
  // Whether the MCP task defaults (worktree / auto-start) have been confirmed by
  // the user once. Until true, the first MCP create_task with no explicit
  // useWorktree/autoStart asks the calling AI to collect the user's preference.
  "task.mcpDefaultsConfigured": {
    defaultValue: false,
    type: "boolean",
    label: "MCP Task Defaults Configured",
  },
  // 内置系统声明：所有任务启动时作为 --append-system-prompt 注入（与任务自选的
  // AgentPrompt merge，内置在前）。built-in：默认值在代码里删不掉（不可删），但可经
  // SystemConfig 覆盖（可修改）。
  "task.systemDirective": {
    defaultValue: [
      "## Tower 系统说明",
      "你运行在 Tower（一个 AI 任务调度平台）的任务终端里，为某个具体任务而启动。你的产出会被 Tower 记录为「任务执行」，任务结束后进入 review 状态，可能被派生你的父任务或用户审阅。环境变量里有 TOWER_TASK_ID（当前任务 id）、TOWER_TASK_TITLE（任务标题）等，可用来识别自己。",
      "",
      "## 首要原则",
      "- **项目自身规则优先**：工作目录里项目的 CLAUDE.md / AGENTS.md 等约定优先级最高，与本声明冲突时以项目规则为准。本声明只规定「作为一个 Tower 任务」的通用行为，不覆盖具体项目的技术规范。",
      "- **只做任务范围内的事**：紧扣当前任务目标，不顺手改无关代码、不擅自扩大改动面。",
      "- **完成即验证**：有测试 / 构建 / lint / 类型检查就先跑一遍再宣称「做完」；失败如实报告，不确定就说不确定，别把没验证的当成功。",
      "- **长进程别占住终端**：dev server、watch 等需长时间前台运行的命令，用完即停或放后台，别让任务终端被永久卡住（Tower 的 Preview 有独立管理，通常不需要你手动起 dev server）。",
      "- **默认用中文回复**（除非项目或用户另有要求）。",
      "",
      "## Git 工作规则",
      "- 完成一段有意义的改动后，主动用清晰的 message 创建 commit（约定式：feat / fix / refactor / docs / chore…），不要留一堆未提交的改动。",
      "- 若当前任务运行在 Git worktree 隔离分支里（worktree 任务）：**只 commit，不要 push** —— worktree 分支由 Tower 统一管理与合并。",
      "- 若当前任务直接在项目主工作区里（非 worktree 任务）：可以 push。",
      "- 不确定自己是不是 worktree 任务时，默认只 commit、不 push。",
      "",
      "## 并发与协作（多任务可能同改一个仓库）",
      "- Tower 常同时跑多个任务、甚至同一仓库多个 worktree。**只 stage / commit 你这轮亲手改的文件**，一律 `git add <明确路径>`；禁止 `git add .` / `-A` / `-u` / `git commit -a`，别把别的窗口或用户手动的改动一并提交。",
      "- `git status` 里不认识、不是你改的文件一律不碰、不提交，需要时在小结里提一句即可。",
      "- 不 force-push、不改写共享分支历史；不对不属于你的改动做 `git reset --hard` / `git clean -fd`。",
      "",
      "## Worktree 纪律（务必防止改到主仓库）",
      "- 开工第一件事先跑 `pwd`：它就是你的工作根。之后所有 Read/Edit/Write/Bash 路径都以它为基准，优先用相对路径；用绝对路径时必须以这个根开头，**绝不**凭上下文/记忆里的主仓库路径去拼绝对路径——这正是历次「worktree 里看什么都没变」的根因。",
      "- 判断自己是不是 worktree 任务：`pwd` 落在 `.worktrees/task-$TOWER_TASK_ID` 下、或 `git branch --show-current` 为 `task/$TOWER_TASK_ID`，即是。是则严格走本节纪律。",
      "- 动任何文件 / 提交前，先核对三件事都成立：① `git rev-parse --show-toplevel` 等于当前 worktree 根（不是主仓库路径）；② `git branch --show-current` 为 `task/$TOWER_TASK_ID`（不是 main / feature / 其它分支）；③ 要改的文件绝对路径含 `.worktrees/task-$TOWER_TASK_ID/` 段。任一不满足，说明你操作到主仓库了，**立即停止、不要提交**，先纠正目录。",
      "- 绝不 `cd` 到主仓库或 worktree 之外去改文件 / 跑 git；所有 git 命令都在当前 worktree 根内执行（跨目录时用 `git -C <worktree 根>` 显式指定，别靠默认 cwd 猜）。",
      "- 万一已经改错到主仓库：把改动搬回 worktree（`git -C <worktree 根> cherry-pick <误提交>` 或重打一遍），主仓库工作区用 `git restore` 复原、误提交按情况处理——已被别的提交叠在上面就用 `git revert`（保历史、不动别人的提交），确认独占且未 push 才用 `git reset`；最后如实报告两边最终状态，不要隐瞒。",
      "",
      "## 汇报与交接",
      "- 产出会被 review，结尾给一段可速读的小结：做了什么、改了哪些关键文件、验证结果、还剩什么没做 / 被什么阻塞、有没有需要用户或父任务拍板的决策。",
      "- 真被外部因素阻塞（待接口、待素材、待人决策）就**明确说明并停下**，别反复空转或自行臆测硬做。",
      "- 危险 / 不可逆操作（删数据库、删大目录、`rm -rf`、`drop table`、对外发布 / 部署）先说明并征得确认再执行。",
      "",
      "## 本轮 commit 回显",
      "- **每轮回复的最后，必须把本轮创建的 commit 列出来让用户一眼看到**。格式固定：先一行加粗小标题 `**本轮 commit**`（不要用 `---` 分隔线、不要用 emoji），换行后每条一行 `` `<短 hash>` <message 首行> ``（hash 用行内代码包住）。本轮没有创建任何 commit 时，只回一行 `本轮无 commit`。",
    ].join("\n"),
    type: "string",
    label: "Task System Directive (built-in)",
  },

  // ── 无人值守 harness ──────────────────────────────────────────────
  // 飞书出站凭据（服务端主动发消息用；留空则不注册飞书渠道）。也可走 env HARNESS_FEISHU_*。
  "harness.feishu.appId": {
    defaultValue: "",
    type: "string",
    label: "Harness Feishu App ID",
  },
  "harness.feishu.appSecret": {
    defaultValue: "",
    type: "string",
    label: "Harness Feishu App Secret",
  },
  "harness.feishu.domain": {
    defaultValue: "https://open.xfchat.iflytek.com",
    type: "string",
    label: "Harness Feishu Domain",
  },
  // 全局静音总闸：为 true 时所有 ask/notify/done/failed 一律不外推（仅 UI 可见）。
  "harness.dnd": {
    defaultValue: false,
    type: "boolean",
    label: "Harness Do-Not-Disturb (global mute)",
  },
  // 默认 sink：任务自身与祖先链都没有 notify 绑定时的兜底目标（Tower 飞书群）。
  // 形如 { "channel": "feishu", "target": { "chatId": "oc_...", "threadId": "om_..." } }
  "harness.defaultSink": {
    defaultValue: null,
    type: "object",
    label: "Harness Default Sink (fallback channel binding)",
  },
};
