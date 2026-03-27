# Requirements: ai-manager

**Defined:** 2026-03-27
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## v0.2 Requirements

Requirements for v0.2 — 项目知识库 & 智能 MCP. Each maps to roadmap phases.

### 智能项目识别

- [x] **PROJ-01**: 用户可通过项目名称、别名、描述模糊匹配找到目标项目
- [x] **PROJ-02**: 搜索结果按字段权重排序（名称 > 别名 > 描述）
- [x] **PROJ-03**: MCP 提供 `identify_project` 工具，返回匹配项目及置信度

### 笔记系统

- [x] **NOTE-01**: 用户可为项目创建、查看、编辑、删除 Markdown 笔记
- [x] **NOTE-02**: 笔记支持预设分类（账号/环境/需求/备忘）和自定义分类
- [x] **NOTE-03**: 用户可通过 FTS5 全文搜索笔记内容（支持中英文）
- [x] **NOTE-04**: MCP 提供 `manage_notes` action-dispatch 工具操作笔记

### 资源管理

- [x] **ASST-01**: 用户可上传文件作为项目级持久化资源（存储在 `data/assets/{projectId}/`）
- [x] **ASST-02**: 任务级临时文件存储在 `data/cache/{taskId}/`，支持手动清理
- [x] **ASST-03**: MCP 提供资源上传工具，通过 mv 将外部文件移入管理目录
- [x] **ASST-04**: Next.js API Route 安全地提供文件访问（防路径穿越）

### Web 界面

- [ ] **UI-01**: 项目内提供笔记管理页面（列表、Markdown 编辑器、分类筛选）
- [ ] **UI-02**: 项目内提供资源查看页面（文件列表、预览、上传）
- [x] **UI-03**: 任务对话中的图片路径渲染为可查看的图片

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### 高级搜索

- **SRCH-01**: 跨项目全局笔记搜索
- **SRCH-02**: 笔记标签系统（除分类外的细粒度标签）

### 协作增强

- **COLLAB-01**: 笔记版本历史和回滚
- **COLLAB-02**: 笔记模板（预设格式，如"环境配置"模板）

## Out of Scope

| Feature | Reason |
|---------|--------|
| 笔记内容加密/脱敏 | 本地工具，单用户，不需要 |
| 语义搜索 (embeddings) | FTS5 足够满足当前需求，避免过度工程 |
| 笔记文件夹嵌套 | 分类已足够，文件夹增加复杂度 |
| 自动 cache 清理 | 用户明确要求手动清理 |
| base64 图片上传 | 本地文件系统 mv 更简单高效 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROJ-01 | Phase 5 | Complete |
| PROJ-02 | Phase 5 | Complete |
| PROJ-03 | Phase 5 | Complete |
| NOTE-01 | Phase 4 | Complete |
| NOTE-02 | Phase 4 | Complete |
| NOTE-03 | Phase 4 | Complete |
| NOTE-04 | Phase 5 | Complete |
| ASST-01 | Phase 4 | Complete |
| ASST-02 | Phase 4 | Complete |
| ASST-03 | Phase 5 | Complete |
| ASST-04 | Phase 6 | Complete |
| UI-01 | Phase 7 | Pending |
| UI-02 | Phase 7 | Pending |
| UI-03 | Phase 6 | Complete |

**Coverage:**
- v0.2 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-27*
*Last updated: 2026-03-27 after roadmap creation*
