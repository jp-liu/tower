# Requirements — v0.94 Cache & File Management

**Defined:** 2026-04-20
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.

## v0.94 Requirements

### 缓存目录结构

- [x] **DIR-01**: 上传图片存储到 `data/cache/assistant/{year-month}/images/` 年月分组目录
- [x] **DIR-02**: 缓存目录支持类型子目录（`images/`），为未来文件类型扩展预留 `files/` 结构
- [x] **DIR-03**: `getAssistantCacheDir()` 自动生成当前年月 + 类型的完整路径

### 文件命名

- [x] **NAME-01**: 复制系统文件粘贴时，保留原始文件名，格式为 `{原始名}-{8位uuid}.{ext}`
- [x] **NAME-02**: 截图或无意义文件名（如 `image.png`）时，使用 `tower_image-{8位uuid}.{ext}`
- [x] **NAME-03**: 文件名清洗：保留中文和英文字母数字，空格和特殊字符替换为 `_`

### 路由适配

- [x] **ROUTE-01**: cache 服务路由改为 catch-all，支持子路径（`/api/internal/cache/2026-04/images/xxx.png`）
- [x] **ROUTE-02**: 前端 `<img src>` 使用完整子路径（含年月和类型目录）
- [x] **ROUTE-03**: `buildMultimodalPrompt` 使用完整子路径拼接绝对路径

### 资产关联

- [ ] **ASSET-01**: `create_task` references 从 cache 复制到 asset 时，自动 strip UUID 后缀还原可读文件名

## Future Requirements

### File Support
- **FILE-01**: 非图片文件粘贴支持（md, txt, pdf）
- **FILE-02**: 拖拽上传
- **FILE-03**: 缓存自动清理策略

## Out of Scope

| Feature | Reason |
|---------|--------|
| 非图片文件粘贴 | 后续 milestone |
| 拖拽上传 | 后续 milestone |
| 缓存自动清理 | 用户手动清理 |
| 视频/音频媒体 | 高复杂度，远期规划 |
| 旧 cache 数据向后兼容 | 开发阶段无用户，旧文件直接清除 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DIR-01 | Phase 44 | Complete |
| DIR-02 | Phase 44 | Complete |
| DIR-03 | Phase 44 | Complete |
| NAME-01 | Phase 44 | Complete |
| NAME-02 | Phase 44 | Complete |
| NAME-03 | Phase 44 | Complete |
| ROUTE-01 | Phase 45 | Complete |
| ROUTE-02 | Phase 45 | Complete |
| ROUTE-03 | Phase 45 | Complete |
| ASSET-01 | Phase 46 | Pending |
