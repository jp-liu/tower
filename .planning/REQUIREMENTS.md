# Requirements: ai-manager

**Defined:** 2026-03-30
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## v0.4 Requirements

Requirements for v0.4 — 系统配置化. Each maps to roadmap phases.

### 配置基础设施

- [x] **CFG-01**: 用户可通过 SystemConfig 表存储和读取系统配置项（key-value）
- [ ] **CFG-02**: 配置变更后实时生效，无需重启服务

### Git 配置

- [x] **GIT-01**: 用户可在设置页添加、编辑、删除 Git 路径映射规则（host + owner → localPath 模板）
- [x] **GIT-02**: 创建项目输入 Git URL 时，自动匹配用户自定义规则生成 localPath
- [ ] **GIT-03**: 用户可配置任务分支命名模板（当前硬编码 vk/${taskId}-）
- [ ] **GIT-04**: 用户可配置 Git 操作超时（clone/status/其他）

### 系统参数

- [ ] **SYS-01**: 用户可配置最大上传文件大小（当前硬编码 50MB）
- [ ] **SYS-02**: 用户可配置最大并发执行数（当前硬编码 3）

### 搜索优化

- [ ] **SRCH-05**: 用户可配置搜索参数（结果数量、All 模式 cap、防抖延迟、snippet 长度）
- [ ] **SRCH-06**: search-actions.ts 和 search-tools.ts 共享搜索逻辑（提取到 src/lib/search.ts）
- [ ] **SRCH-07**: 搜索 useEffect 竞态条件修复（cancelled flag 防止旧请求覆盖新结果）

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### 高级配置

- **CFG-F01**: 配置导入/导出（JSON 文件备份恢复）
- **CFG-F02**: 配置重置为默认值功能
- **CFG-F03**: 项目搜索权重可配置

## Out of Scope

| Feature | Reason |
|---------|--------|
| 配置文件替代数据库 | 数据库统一管理更简单，避免文件同步问题 |
| 多用户配置隔离 | 本地单用户工具，不需要 |
| 配置变更审计日志 | 个人工具无审计需求 |
| i18n.tsx 拆分 | 虽然接近 800 行但可以后续做，不影响配置化 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 11 | Complete |
| CFG-02 | Phase 14 | Pending |
| GIT-01 | Phase 12 | Complete |
| GIT-02 | Phase 12 | Complete |
| GIT-03 | Phase 13 | Pending |
| GIT-04 | Phase 13 | Pending |
| SYS-01 | Phase 13 | Pending |
| SYS-02 | Phase 13 | Pending |
| SRCH-05 | Phase 13 | Pending |
| SRCH-06 | Phase 14 | Pending |
| SRCH-07 | Phase 14 | Pending |

**Coverage:**
- v0.4 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-03-30*
