# Tower 系统文档

按模块拆分的技术文档，用于开发参考和 GSD phase 规划。

## 模块索引

| 模块 | Slug | 目录 | 说明 |
|------|------|------|------|
| Workspace | `workspace` | [workspace/](workspace/) | 工作区管理 |
| Project | `project` | [project/](project/) | 项目 CRUD、导入、git 仓库 |
| Task | `task` | [task/](task/) | 任务 CRUD、状态流转、详情页 |
| Board | `board` | [board/](board/) | 看板 UI、拖拽排序、筛选 |
| Terminal | `terminal` | [terminal/](terminal/) | PTY 会话、WebSocket、xterm.js |
| Assistant | `assistant` | [assistant/](assistant/) | AI 助手聊天、SSE 流式 |
| Missions | `missions` | [missions/](missions/) | 多任务监控面板 |
| Search | `search` | [search/](search/) | 全局搜索、代码搜索、FTS |
| Settings | `settings` | [settings/](settings/) | 系统配置、CLI Profile、Agent 配置 |
| MCP | `mcp` | [mcp/](mcp/) | MCP Server、工具链 |
| Git | `git` | [git/](git/) | Git 操作、Worktree、Diff、Merge |
| Assets & Notes | `assets` | [assets-notes/](assets-notes/) | 项目资产、笔记 |
| AI | `ai` | [ai/](ai/) | Claude SDK、CLI Adapter、执行总结、Prompt |
| I18n | `i18n` | [i18n/](i18n/) | 国际化、中英双语 |

## 架构图

浏览器打开 HTML 文件查看（暗色主题，自适应缩放）。

| 图 | 文件 | 说明 |
|----|------|------|
| 系统架构 | [diagrams/tower-system-architecture.html](diagrams/tower-system-architecture.html) | 7 层：客户端→服务端→WS→PTY→DB/MCP→AI→外部 |
| 数据模型 | [diagrams/tower-data-model.html](diagrams/tower-data-model.html) | 13 实体 ER 图，含关联和级联删除 |
| 任务生命周期 | [diagrams/tower-task-lifecycle.html](diagrams/tower-task-lifecycle.html) | 创建→执行→运行→退出→评审流程 |
| AI 架构 | [diagrams/tower-ai-architecture.html](diagrams/tower-ai-architecture.html) | Agent SDK / CLI PTY / 能力矩阵 |
| 模块依赖 | [diagrams/tower-module-map.html](diagrams/tower-module-map.html) | 14 模块 4 层依赖关系 |

## TODO

- [x] 用户确认模块划分（增删改 slug、合并/拆分模块）
- [x] 将最终模块列表写入 AGENTS.md，供 GSD 读取
- [x] 生成系统架构图（5 张暗色主题 HTML）
- [ ] 配置 `.planning/config.json` 的 commit scope 映射
- [ ] 各模块文档补充完善（API 细节、状态图、交互流程）

## GSD Commit Scope 映射

GSD phase 按模块命名时，commit scope 使用上表的 **Slug** 列。

示例：
- `feat(workspace-08.01): add workspace archiving`
- `fix(terminal-12.02): fix PTY reconnect on timeout`
- `refactor(board-05.01): extract kanban column component`
