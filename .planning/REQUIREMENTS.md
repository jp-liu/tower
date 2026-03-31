# Requirements: ai-manager

**Defined:** 2026-03-30
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## v0.4 Requirements

Requirements for v0.4 — 系统配置化. Each maps to roadmap phases.

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

## v0.5 Requirements

Requirements for v0.5 — Git Worktree 任务隔离. Each maps to roadmap phases.

### 任务分支选择

- [ ] **BR-01**: 创建任务时可从项目 git branches 列表选择 base branch
- [x] **BR-02**: Task 数据模型新增 baseBranch 字段

### Worktree 执行隔离

- [x] **WT-01**: 任务执行前自动创建 worktree（`{localPath}/.worktrees/task-{taskId}`）+ 独立分支 `task/{taskId}`
- [x] **WT-02**: Claude CLI 在 worktree 目录中执行（cwd 切换到 worktree）
- [x] **WT-03**: TaskExecution 数据模型新增 worktreePath、worktreeBranch 字段
- [x] **WT-04**: 同项目多任务可并行执行，各自在独立 worktree 中工作

### 合并与验证

- [ ] **MR-01**: 任务完成后状态变为 IN_REVIEW，用户可在任务面板查看 diff
- [ ] **MR-02**: 用户可在任务面板 squash merge worktree 分支到任务的 base branch
- [ ] **MR-03**: 合并前自动检测冲突，有冲突时提示用户

### 退回重做

- [ ] **RV-01**: IN_REVIEW 状态的任务可退回 IN_PROGRESS，Claude 在同一 worktree 继续修改
- [ ] **RV-02**: 退回重做创建新的 TaskExecution 记录，复用同一 worktree 和分支

### Worktree 生命周期

- [ ] **LC-01**: 任务 DONE 或 CANCELLED 后自动清理 worktree 目录和分支
- [ ] **LC-02**: 应用启动时执行 `git worktree prune` 清理孤立 worktree

### 配置清理

- [x] **CL-01**: 移除设置页 git.branchTemplate 配置项和相关代码（interpolateBranchTemplate 等）

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

## Out of Scope

| Feature | Reason |
|---------|--------|
| 配置文件替代数据库 | 数据库统一管理更简单，避免文件同步问题 |
| 多用户配置隔离 | 本地单用户工具，不需要 |
| 配置变更审计日志 | 个人工具无审计需求 |
| i18n.tsx 拆分 | 虽然接近 800 行但可以后续做，不影响配置化 |
| 在 main 上 revert 后重新 merge | git revert 历史污染导致冲突，改用 squash merge 一次性合并 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 11 | Complete |
| CFG-02 | Phase 14 | Complete |
| GIT-01 | Phase 12 | Complete |
| GIT-02 | Phase 12 | Complete |
| GIT-03 | Phase 13 | Complete |
| GIT-04 | Phase 13 | Complete |
| SYS-01 | Phase 13 | Complete |
| SYS-02 | Phase 13 | Complete |
| SRCH-05 | Phase 13 | Complete |
| SRCH-06 | Phase 14 | Complete |
| SRCH-07 | Phase 14 | Complete |
| BR-02 | Phase 15 | Complete |
| WT-03 | Phase 15 | Complete |
| CL-01 | Phase 15 | Complete |
| BR-01 | Phase 16 | Pending |
| WT-01 | Phase 16 | Complete |
| WT-02 | Phase 16 | Complete |
| WT-04 | Phase 16 | Complete |
| MR-01 | Phase 17 | Pending |
| MR-02 | Phase 17 | Pending |
| MR-03 | Phase 17 | Pending |
| RV-01 | Phase 17 | Pending |
| RV-02 | Phase 17 | Pending |
| LC-01 | Phase 18 | Pending |
| LC-02 | Phase 18 | Pending |

**v0.5 Coverage:**
- v0.5 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0

---
*Requirements updated: 2026-03-31 — v0.5 phase mappings added (Phases 15-18)*
