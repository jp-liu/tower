# Requirements — v0.95 Pre-Release Hardening

**Defined:** 2026-04-20
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.

## v0.95 Requirements

### 测试修复

- [x] **TEST-01**: 修复 pty-session.test.ts 失败测试（addExitListener → setExitListener API 变更）
- [x] **TEST-02**: 修复 preview-process-manager.test.ts 失败测试（mock ChildProcess 缺少 .on() 方法）
- [x] **TEST-03**: 修复 instrumentation.test.ts 失败测试（Prisma mock db 未初始化）
- [x] **TEST-04**: 修复组件测试（board-stats 缺 I18nProvider、prompts-config 缺 Router context）
- [x] **TEST-05**: 修复 create-task-dialog.test.tsx（git-actions mock 缺少 getCurrentBranch 导出）
- [x] **TEST-06**: 修复 asset-item.test.tsx URL 断言不匹配 和 manage-notes.test.ts 排序断言错误

### 安全加固

- [x] **SEC-01**: `/api/files/assets/[projectId]/[filename]` 路由添加 projectId CUID 格式校验，拒绝非法 ID

### 测试覆盖 — Server Actions

- [x] **COV-01**: workspace-actions.ts 单元测试（CRUD + getWorkspacesWithProjects）
- [x] **COV-02**: label-actions.ts 单元测试（CRUD + builtin 保护 + setTaskLabels）
- [x] **COV-03**: note-actions.ts 单元测试（CRUD + FTS 搜索）
- [x] **COV-04**: prompt-actions.ts 单元测试（CRUD + default 管理）
- [x] **COV-05**: asset-actions.ts 单元测试（上传 + 下载 + 删除）
- [x] **COV-06**: cli-profile-actions.ts 单元测试（CRUD + default 唯一性）
- [x] **COV-07**: report-actions.ts 单元测试（dailySummary + dailyTodo）

### 测试覆盖 — MCP Tools

- [x] **COV-08**: task-tools.ts 单元测试（create/update/move/delete + references + worktree）
- [x] **COV-09**: project-tools.ts 单元测试（CRUD + type 派生）
- [x] **COV-10**: workspace-tools.ts 单元测试（CRUD + 级联删除验证）
- [x] **COV-11**: terminal-tools.ts 单元测试（get_output/send_input/get_status）
- [x] **COV-12**: label-tools.ts 单元测试（CRUD + set_task_labels 全量替换）
- [x] **COV-13**: report-tools.ts 单元测试（daily_summary + daily_todo 过滤）

### 测试覆盖 — Core Lib

- [x] **COV-14**: internal-api-guard.ts 单元测试（localhost 校验 + x-forwarded-for 检测）
- [x] **COV-15**: schemas.ts 单元测试（Zod schema 边界值）
- [x] **COV-16**: diff-parser.ts 单元测试（diff 解析 + 边界情况）
- [x] **COV-17**: file-serve.ts 单元测试（路径解析 + 遏制检查 + MIME 类型）

### 测试覆盖 — Hooks & 逻辑抽离

- [x] **COV-18**: 抽离组件内业务逻辑到 hooks/utils 并补充测试
- [x] **COV-19**: use-image-upload.ts hook 单元测试

### 测试覆盖 — Lib 补充

- [x] **COV-20**: config-reader.ts 单元测试
- [x] **COV-21**: assistant-sessions.ts 单元测试
- [x] **COV-22**: execution-summary.ts 单元测试
- [x] **COV-23**: logger.ts 单元测试

### E2E 测试

- [ ] **E2E-01**: Playwright 核心流程测试 — 创建任务 + 启动执行 + 状态变更 + 完成
- [ ] **E2E-02**: Playwright 聊天流程测试 — 发送消息 + 图片粘贴 + 消息显示
- [ ] **E2E-03**: Playwright 设置流程测试 — 配置修改 + 保存 + 生效验证

### 错误处理

- [ ] **ERR-01**: task-page-client.tsx 静默 .catch(() => {}) 改为 toast.error 用户可见提示

### 代码重构

- [ ] **REF-01**: i18n.tsx（1192 行）拆分为语言模块（zh.ts / en.ts）按需加载
- [ ] **REF-02**: 清理 5 处 `as any` 类型强转，使用正确的 TypeScript 类型窄化

## Future Requirements

### v1.1 Component Testing
- **COMP-01**: 关键交互组件单元测试（kanban-board、task-detail-panel）
- **COMP-02**: 表单组件测试（create-task-dialog、settings 各卡片）

### v1.1+ Features
- **FILE-01**: 非图片文件粘贴支持（md, txt, pdf）
- **FILE-02**: 拖拽上传
- **FILE-03**: 缓存自动清理策略

## Out of Scope

| Feature | Reason |
|---------|--------|
| 纯展示组件单元测试 | E2E 覆盖更有效，v1.1 再按需补充 |
| 性能优化 | 无性能瓶颈反馈，暂不优化 |
| 新功能开发 | v0.95 专注健壮性，不加新功能 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 47 | Planned |
| TEST-02 | Phase 47 | Planned |
| TEST-03 | Phase 47 | Planned |
| TEST-04 | Phase 47 | Planned |
| TEST-05 | Phase 47 | Planned |
| TEST-06 | Phase 47 | Planned |
| SEC-01 | Phase 48 | Planned |
| COV-14 | Phase 48 | Planned |
| COV-01 | Phase 49 | Planned |
| COV-02 | Phase 49 | Planned |
| COV-03 | Phase 49 | Planned |
| COV-04 | Phase 49 | Planned |
| COV-05 | Phase 49 | Planned |
| COV-06 | Phase 49 | Planned |
| COV-07 | Phase 49 | Planned |
| COV-08 | Phase 50 | Planned |
| COV-09 | Phase 50 | Planned |
| COV-10 | Phase 50 | Planned |
| COV-11 | Phase 50 | Planned |
| COV-12 | Phase 50 | Planned |
| COV-13 | Phase 50 | Planned |
| COV-15 | Phase 51 | Planned |
| COV-16 | Phase 51 | Planned |
| COV-17 | Phase 51 | Planned |
| COV-20 | Phase 51 | Planned |
| COV-21 | Phase 51 | Planned |
| COV-22 | Phase 51 | Planned |
| COV-23 | Phase 51 | Planned |
| COV-18 | Phase 52 | Planned |
| COV-19 | Phase 52 | Planned |
| E2E-01 | Phase 53 | Planned |
| E2E-02 | Phase 53 | Planned |
| E2E-03 | Phase 53 | Planned |
| ERR-01 | Phase 54 | Planned |
| REF-01 | Phase 54 | Planned |
| REF-02 | Phase 54 | Planned |
