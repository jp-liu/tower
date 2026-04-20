# Phase 17: Review & Merge Workflow - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 17-review-merge-workflow
**Areas discussed:** Diff 展示方式, 合并操作交互, 退回重做流程, IN_REVIEW 转换

---

## Diff 展示方式

### Q1: Diff 在任务面板里怎么展示？

| Option | Description | Selected |
|--------|-------------|----------|
| 按文件折叠 | 每个文件一个折叠块，点击展开看 unified diff | |
| 统一滚动视图 | 所有文件 diff 拼接在一起滚动 | |
| 纯文本 pre 块 | 原始 git diff 输出放在 pre 块里 | |
| Other | 用户自定义方案 | |

**User's choice:** 任务专属页面方案 — 抽屉加"查看详情"按钮进入独立页面，左边聊天框，右边大容器有 Tab 切换（Changes/文件浏览/Preview）
**Notes:** 文件浏览器和 iframe Preview 被推迟到后续 phase，Phase 17 先做核心流程

### Q2: Diff 放在任务面板的哪个位置？

| Option | Description | Selected |
|--------|-------------|----------|
| 对话上方新区域 | 在 task-detail-panel 里对话列表上方增加可折叠区域 | |
| 新的独立 Tab | 任务面板增加 Conversation 和 Changes 两个 Tab | |
| 弹窗/浮层 | 点击按钮打开全屏弹窗展示 diff | |
| Other | 用户自定义方案 | ✓ |

**User's choice:** 新建 `/workspaces/[wsId]/tasks/[taskId]` 路由，左聊天右 diff。抽屉里也加简化版 Tab。
**Notes:** 用户提出抽屉太小需要独立页面，同时保留抽屉简化版

### Q3: 任务专属页面的路由怎么设计？

| Option | Description | Selected |
|--------|-------------|----------|
| /workspaces/[wsId]/tasks/[taskId] | 新建独立路由 | ✓ |
| 当前页面全屏模态 | 不新建路由，全屏弹出 | |

**User's choice:** /workspaces/[wsId]/tasks/[taskId]

---

## 合并操作交互

### Q1: Squash Merge 按钮放在哪里？

| Option | Description | Selected |
|--------|-------------|----------|
| 任务专属页 diff 区域上方 | diff 视图上方放 Merge 和 Send Back 按钮 | ✓ |
| 任务卡片右键菜单 | Kanban 卡片上右键加选项 | |
| 任务元数据区 | 在 task-metadata 组件里加按钮 | |

**User's choice:** 任务专属页 diff 区域上方

### Q2: 点击 Merge 后需要确认弹窗吗？

| Option | Description | Selected |
|--------|-------------|----------|
| 需要确认弹窗 | 显示目标分支、改动文件数、commit 数 | ✓ |
| 直接执行 | 点击就合并不弹窗 | |

**User's choice:** 需要确认弹窗

### Q3: 合并前检测到冲突时怎么处理？

| Option | Description | Selected |
|--------|-------------|----------|
| 禁用 Merge 按钮 + 提示 | 按钮置灰，显示冲突文件列表 | ✓ |
| 允许合并但警告 | 显示警告但仍允许强制合并 | |

**User's choice:** 禁用 Merge 按钮 + 提示

### Q4: 合并成功后任务状态怎么变？

| Option | Description | Selected |
|--------|-------------|----------|
| 自动转 DONE | 合并成功后自动设为 DONE | ✓ |
| 保持 IN_REVIEW | 用户手动拖到 DONE | |

**User's choice:** 自动转 DONE

### Q5: Squash merge 的 commit message 怎么生成？

| Option | Description | Selected |
|--------|-------------|----------|
| 自动生成 + 可编辑 | 默认生成 feat: {taskTitle}，用户可修改 | |
| 用户必须手动输入 | 确认弹窗里必填 | |
| 固定格式不可改 | 始终用固定格式 | |
| Other | 用户自定义方案 | ✓ |

**User's choice:** 自动生成不可编辑。任务执行期间 Claude 在 worktree 里的 commit 记录保留。

---

## 退回重做流程

### Q1: 点击"退回"时需要用户输入退回理由吗？

| Option | Description | Selected |
|--------|-------------|----------|
| 必填退回消息 | 弹窗要求输入退回理由 | |
| 直接退回不要求输入 | 一键退回 | |
| 可选填写 | 显示输入框但不强制 | |
| Other | 用户自定义方案 | ✓ |

**User's choice:** 不需要单独的"退回"按钮。在 IN_REVIEW 状态下，用户直接在聊天框描述修改需求，发送消息即自动退回 IN_PROGRESS 并启动新执行。
**Notes:** 更自然的交互流程，复用现有聊天 UI

---

## IN_REVIEW 转换

### Q1: 任务何时自动进入 IN_REVIEW？

| Option | Description | Selected |
|--------|-------------|----------|
| 执行成功完成时自动转 | exitCode=0 时自动转 IN_REVIEW | ✓ |
| 用户手动拖动 | 执行完成保持 IN_PROGRESS | |
| 所有执行完成都转 | 无论成功失败都转 | |

**User's choice:** 执行成功完成时自动转

---

## Claude's Discretion

- 任务页面左右布局比例
- Diff 语法高亮方案
- Loading 状态和骨架屏
- i18n key 命名
- Git diff 解析逻辑

## Deferred Ideas

- 文件系统浏览器 Tab — 后续 phase
- iframe 前端 Preview Tab — 后续 phase
- 冲突解析 UI（显示冲突文件，发送 Claude 修复）— WT-F02
