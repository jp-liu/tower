# Requirements: v0.97 Workflow Enhancement & Developer Experience

## Form UX (项目表单交互)

- [x] **FORM-01**: User can create project with plain text path input (no browse button), path is editable
- [ ] **FORM-02**: User can import project via browse dialog, selected localPath is read-only (not editable)
- [ ] **FORM-03**: User can migrate project with editable target path
- [ ] **FORM-04**: Project description and task description textarea have max-height with overflow-y scroll (prevent dialog height overflow)
- [x] **FORM-05**: Git cloneDir setting shows warning text "请输入绝对路径，不支持 ~ 别名", backend rejects paths starting with ~

## UI Polish (界面优化)

- [ ] **UI-01**: Assistant chat icon moved from language toggle area to right side of search box in header

## Project Analysis (项目智能分析)

- [ ] **ANALYZE-01**: "生成描述" button appears next to clone button and below import localPath field
- [ ] **ANALYZE-02**: Button disabled (greyed out) with tooltip "请先选择路径" when no localPath is set or project not cloned
- [ ] **ANALYZE-03**: Clicking button invokes Claude CLI to analyze localPath directory structure (package.json, README, src/, monorepo detection)
- [ ] **ANALYZE-04**: Analysis result auto-fills project description textarea with structured Markdown (tech stack, module breakdown, MCP subPath guidance)

## Mission Control (任务监控增强)

- [ ] **MISSION-01**: "在终端打开" button in Mission card or toolbar, opens system terminal at project.localPath

## Code Search (全局代码搜索)

- [ ] **SEARCH-01**: Detail page left panel has two tabs: "文件树" (existing) and "搜索" (new)
- [ ] **SEARCH-02**: Search tab has input field with ripgrep-powered search scoped to project.localPath
- [ ] **SEARCH-03**: Search supports regex patterns and file type/glob filtering
- [ ] **SEARCH-04**: Search results display file path, line number, and matching line content with keyword highlighting
- [ ] **SEARCH-05**: Clicking a search result opens the file in Monaco editor at the matching line

## Future Requirements (deferred to Preview milestone)

- 启动配置模型 (startCommand / startPort / packageManager / workDir fields on Project)
- Mission "启动项目" button (read config, PTY execute)
- Preview 前端项目 iframe 嵌入预览
- 启动脚本编辑器（质效工作流风格）

## Out of Scope

- 后端项目 Preview — 复杂度高，暂不支持
- 多编辑器同时打开 — 用代码搜索替代
- 全路径任意搜索 — 限制在已注册项目 localPath 内

## Traceability

| REQ-ID | Phase | Plan |
|--------|-------|------|
| FORM-01 | Phase 61 | TBD |
| FORM-02 | Phase 61 | TBD |
| FORM-03 | Phase 61 | TBD |
| FORM-04 | Phase 61 | TBD |
| FORM-05 | Phase 61 | TBD |
| UI-01 | Phase 61 | TBD |
| ANALYZE-01 | Phase 62 | TBD |
| ANALYZE-02 | Phase 62 | TBD |
| ANALYZE-03 | Phase 62 | TBD |
| ANALYZE-04 | Phase 62 | TBD |
| MISSION-01 | Phase 63 | TBD |
| SEARCH-01 | Phase 64 | TBD |
| SEARCH-02 | Phase 64 | TBD |
| SEARCH-03 | Phase 64 | TBD |
| SEARCH-04 | Phase 64 | TBD |
| SEARCH-05 | Phase 64 | TBD |
