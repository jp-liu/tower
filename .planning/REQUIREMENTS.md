# Requirements: ai-manager

**Defined:** 2026-03-30
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## v0.6 Requirements

Requirements for v0.6 — 任务开发工作台. Each maps to roadmap phases.

### 工作台入口

- [x] **WB-01**: 用户可从任务抽屉点击"查看详情"跳转到任务专属工作台页面
- [x] **WB-02**: 工作台页面左侧为 AI 聊天窗口，右侧为多标签面板（文件/变更/预览）

### 在线编辑器

- [x] **ED-01**: 用户可在工作台中打开文件并查看语法高亮代码（Monaco Editor）
- [x] **ED-02**: 用户可通过 Ctrl+S 保存文件到 worktree 磁盘
- [x] **ED-03**: 编辑器显示未保存文件标记（dirty dot）
- [x] **ED-04**: 用户可同时打开多个文件标签页切换编辑
- [x] **ED-05**: 编辑器主题跟随 ai-manager 的 dark/light 设置

### 文件树浏览器

- [x] **FT-01**: 用户可浏览任务 worktree 的目录结构（展开/折叠文件夹，文件图标）
- [x] **FT-02**: 点击文件树中的文件在编辑器中打开
- [x] **FT-03**: 文件树自动过滤 gitignore 规则匹配的目录和文件
- [x] **FT-04**: Claude 执行期间文件树每 2 秒自动刷新
- [x] **FT-05**: 用户可通过右键菜单新建文件/文件夹、重命名、删除
- [x] **FT-06**: 文件树节点显示 git 变更状态标记（M/A/D）

### Diff 查看

- [ ] **DF-01**: 工作台"变更"标签页展示 task 分支与 base 分支的 diff（复用 v0.5 现有组件）

### 预览面板

- [x] **PV-01**: 项目支持"前端/后端"类型区分，创建时默认前端，可选后端
- [x] **PV-02**: 前端项目工作台有预览面板，包含地址栏输入本地 URL + iframe 嵌入显示
- [x] **PV-03**: 用户可配置项目预览启动命令，点击"运行"按钮启动 dev server
- [x] **PV-04**: 预览面板提供"在终端打开"按钮，在本地终端 app 中打开 worktree 目录
- [x] **PV-05**: 用户可在设置中配置默认终端应用（iTerm2/Terminal.app/Warp 等）
- [ ] **PV-06**: 编辑器保存文件后自动刷新预览 iframe

## v0.4 Requirements (Complete)

<details>
<summary>v0.4 — 系统配置化 (all complete)</summary>

### 配置基础设施

- [x] **CFG-01**: 用户可通过 SystemConfig 表存储和读取系统配置项（key-value）
- [x] **CFG-02**: 配置变更后实时生效，无需重启服务

### Git 配置

- [x] **GIT-01**: 用户可在设置页添加、编辑、删除 Git 路径映射规则（host + owner → localPath 模板）
- [x] **GIT-02**: 创建项目输入 Git URL 时，自动匹配用户自定义规则生成 localPath
- [x] **GIT-03**: 用户可配置任务分支命名模板（当前硬编码 vk/${taskId}-）
- [x] **GIT-04**: 用户可配置 Git 操作超时（clone/status/其他）

### 系统参数

- [x] **SYS-01**: 用户可配置最大上传文件大小（当前硬编码 50MB）
- [x] **SYS-02**: 用户可配置最大并发执行数（当前硬编码 3）

### 搜索优化

- [x] **SRCH-05**: 用户可配置搜索参数（结果数量、All 模式 cap、防抖延迟、snippet 长度）
- [x] **SRCH-06**: search-actions.ts 和 search-tools.ts 共享搜索逻辑（提取到 src/lib/search.ts）
- [x] **SRCH-07**: 搜索 useEffect 竞态条件修复（cancelled flag 防止旧请求覆盖新结果）

</details>

## v0.5 Requirements (Complete)

<details>
<summary>v0.5 — Git Worktree 任务隔离 (all complete)</summary>

### 任务分支选择

- [x] **BR-01**: 创建任务时可从项目 git branches 列表选择 base branch
- [x] **BR-02**: Task 数据模型新增 baseBranch 字段

### Worktree 执行隔离

- [x] **WT-01**: 任务执行前自动创建 worktree（`{localPath}/.worktrees/task-{taskId}`）+ 独立分支 `task/{taskId}`
- [x] **WT-02**: Claude CLI 在 worktree 目录中执行（cwd 切换到 worktree）
- [x] **WT-03**: TaskExecution 数据模型新增 worktreePath、worktreeBranch 字段
- [x] **WT-04**: 同项目多任务可并行执行，各自在独立 worktree 中工作

### 合并与验证

- [x] **MR-01**: 任务完成后状态变为 IN_REVIEW，用户可在任务面板查看 diff
- [x] **MR-02**: 用户可在任务面板 squash merge worktree 分支到任务的 base branch
- [x] **MR-03**: 合并前自动检测冲突，有冲突时提示用户

### 退回重做

- [x] **RV-01**: IN_REVIEW 状态的任务可退回 IN_PROGRESS，Claude 在同一 worktree 继续修改
- [x] **RV-02**: 退回重做创建新的 TaskExecution 记录，复用同一 worktree 和分支

### Worktree 生命周期

- [x] **LC-01**: 任务 DONE 或 CANCELLED 后自动清理 worktree 目录和分支
- [x] **LC-02**: 应用启动时执行 `git worktree prune` 清理孤立 worktree

### 配置清理

- [x] **CL-01**: 移除设置页 git.branchTemplate 配置项和相关代码（interpolateBranchTemplate 等）

</details>

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### 高级配置

- **CFG-F01**: 配置导入/导出（JSON 文件备份恢复）
- **CFG-F02**: 配置重置为默认值功能
- **CFG-F03**: 项目搜索权重可配置

### Worktree 高级功能

- **WT-F01**: Worktree 存储路径可配置（默认项目旁边，可改为集中管理）
- **WT-F02**: 合并冲突解析 UI（显示冲突文件，发送 Claude 修复）
- **WT-F03**: 合并队列（串行合并，自动 rebase）

### 编辑器进阶

- **ED-F01**: TypeScript IntelliSense / LSP 支持
- **ED-F02**: AI 内联建议（基于任务聊天上下文）
- **ED-F03**: 保存时自动格式化（Prettier）

### 预览进阶

- **PV-F01**: 预览进程 stdout 实时流式输出
- **PV-F02**: 多预览命令支持（Storybook + 应用同时启动）
- **PV-F03**: 移动端视口模拟（iframe 尺寸选择器）

## Out of Scope

| Feature | Reason |
|---------|--------|
| 配置文件替代数据库 | 数据库统一管理更简单，避免文件同步问题 |
| 多用户配置隔离 | 本地单用户工具，不需要 |
| WebContainer 浏览器内运行 | localhost 已有 Node.js，child_process 更简单可靠 |
| 自动保存（auto-save） | 与 Claude CLI 并发写文件冲突，使用显式 Ctrl+S |
| 可编辑 diff 视图 | 编辑器和 diff 状态合并复杂，diff 保持只读 |
| 跨 worktree 文件操作 | worktree 隔离是设计核心，跨操作有数据风险 |
| 完整终端模拟器（xterm.js） | 范围过大，AI 聊天面板已覆盖命令执行需求 |
| OAuth/cookie iframe 穿透 | 本地工具不常需要，可直接在浏览器新标签页登录 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WB-01 | Phase 19 | Complete |
| WB-02 | Phase 19 | Complete |
| FT-01 | Phase 20 | Complete |
| FT-02 | Phase 20 | Complete |
| FT-03 | Phase 20 | Complete |
| FT-04 | Phase 20 | Complete |
| FT-05 | Phase 20 | Complete |
| FT-06 | Phase 20 | Complete |
| ED-01 | Phase 21 | Complete |
| ED-02 | Phase 21 | Complete |
| ED-03 | Phase 21 | Complete |
| ED-04 | Phase 21 | Complete |
| ED-05 | Phase 21 | Complete |
| DF-01 | Phase 22 | Pending |
| PV-01 | Phase 23 | Complete |
| PV-02 | Phase 23 | Complete |
| PV-03 | Phase 23 | Complete |
| PV-04 | Phase 23 | Complete |
| PV-05 | Phase 23 | Complete |
| PV-06 | Phase 23 | Pending |

**v0.6 Coverage:**
- v0.6 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-03-31 — traceability filled after v0.6 roadmap creation (Phases 19-23)*
