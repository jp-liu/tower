---
title: Project 模块
description: 项目管理，支持普通项目和 Git 项目两种类型
---

**Slug:** `project`

## 功能介绍

项目属于工作区，是任务的组织单元。可以关联 Git 仓库或本地目录，创建时根据是否提供 Git URL 自动判定项目类型（普通项目 / Git 项目）。

主要操作：

- **创建项目**：在工作区下新建项目，填写名称、别名、描述等基本信息；对话框内可选择所属**工作区**、所属**分组（Product Group）**
- **导入本地项目**：通过导入对话框浏览本地目录，自动检测 Git remote 信息并填充 gitUrl；同样支持选择工作区和分组，Git 项目可选迁移到规范路径
- **关联 Git 仓库**：提供 Git URL 后自动标记为 GIT 类型项目，支持后续的 Worktree 隔离执行和 Diff/Merge 功能
- **关联本地目录**：指定 localPath，用于代码搜索、预览、项目分析等功能
- **生成描述**：点击「生成描述」按钮，AI 自动分析项目的 localPath 目录结构，生成结构化的项目描述
- **加入产品分组**：把同一产品的多个仓库（前端 / 后端 / trace 静态知识库 / 需求）归入一个 Product Group，知识库问答时同组项目一起检索
- **删除项目**：级联删除项目下的所有任务

### 新建 / 导入对话框选项

两个对话框（`create-project-dialog` / `import-project-dialog`）字段一致：

- **工作区**：当存在多个工作区时显示下拉选择，默认取当前高亮工作区；切换工作区会清空已选分组
- **分组**：选中工作区后显示 `GroupSelect` 下拉，可选「无分组 / 现有组 / + 新建组」，新建组内联输入名称即时创建并选中
- **项目类型**：`FRONTEND` / `BACKEND`（用于知识库分组语义）
- **gitUrl / localPath**：新建以 Git URL 为主并自动派生项目名与本地路径，可点「Clone」拉取；导入以「浏览文件夹」为主，选完自动探测 git remote

> **注意**：分组不是随项目一次性创建的——`createProject` **不接受** `groupId`。对话框先创建项目拿到 id，再调用 `setProjectGroup(projectId, groupId)` 完成绑定。

## 详细说明

### 数据模型

```
ProductGroup (id, name, description?)          // 工作区内产品分组，组名工作区内唯一
  └── Project[]

Project (id, name, alias?, description?, type, gitUrl?, localPath?, groupId?, knowledgeDir?)
  ├── Task[]
  ├── Repository[]
  └── ProjectFact[] (key, value)               // 结构化事实卡，知识库精确命中源
```

- `type`: `NORMAL` | `GIT`，由 `gitUrl` 是否存在自动推导，不可手动设置
- `workspaceId`: FK → Workspace，级联删除
- `groupId?`: FK → ProductGroup，`onDelete: SetNull`；删除分组时成员项目自动解绑但不删除
- `knowledgeDir?`: 覆盖仓库内知识库目录（默认 `docs/知识库`）

### 项目类型

项目类型由 `gitUrl` 字段自动推导：
- 提供了 `gitUrl` → `GIT` 类型，支持 Worktree 隔离、Diff 查看、Merge 操作
- 未提供 `gitUrl` → `NORMAL` 类型，仅支持基础任务管理

### Product Group（产品分组）

Product Group 是工作区下的一等实体，把同一产品的多个仓库归为一组，用于**跨仓库知识库检索**。

- **概念**：一个产品往往拆成多个仓库（前端 / 后端 / trace 静态知识库 / 需求）。把它们分到同一个组后，`ask_project_knowledge` 对其中任一项目提问时，会自动把同组所有兄弟项目一起纳入检索范围。
- **创建**：在新建 / 导入项目对话框的分组下拉里选「+ 新建组」内联创建，或用 MCP `create_product_group` / server action `createProductGroup`。组名在工作区内唯一。
- **加入分组**：`setProjectGroup(projectId, groupId)`（UI）或 MCP `update_project` 的 `groupId` 参数；传 `null`/`""` 解绑。
- **同工作区约束**：一个组的所有成员必须属于同一个工作区。因为知识库检索层只按 `groupId` 聚合、不再按工作区过滤，跨工作区分配会串知识区，故分配时强制校验同区。

### 知识库检索

`ask_project_knowledge`（`src/lib/knowledge.ts`）聚合四类数据源，Tower 只做「检索 + 聚合」，由调用方 LLM 组织最终答案：

1. **仓库内知识文件**：`<localPath>/<knowledgeDir>/*.md`（默认 `docs/知识库`，`knowledgeDir` 可覆盖；有目录逃逸校验）
2. **事实卡 `ProjectFact`**：机器拿不到、需人工/AI 维护的项目级 key-value（生产/CICD 路径、域名等），经 `manage_project_facts` 管理
3. **版本与合并提交**：`Version` + 任务的 `mergeCommit`/`branch`/`changelog`
4. **数据库笔记**：`ProjectNote`（FTS 全文检索）

若项目设置了 `groupId`，检索范围扩展到同组全部项目。

## 文件清单

### Server Actions (`src/actions/`)

| 文件 | 函数 | 说明 |
|------|------|------|
| `workspace-actions.ts` | `createProject`, `updateProject`, `deleteProject` | 项目 CRUD（`createProject` 不接受 `groupId`） |
| `workspace-actions.ts` | `getProjectByLocalPath(path)` | 按本地路径查找 |
| `workspace-actions.ts` | `getRecentLocalProjects(limit?)` | 最近本地项目 |
| `group-actions.ts` | `getProductGroups`, `createProductGroup`, `updateProductGroup`, `deleteProductGroup`, `setProjectGroup` | 产品分组 CRUD 与项目↔分组绑定 |
| `project-actions.ts` | 项目分析相关 | 项目描述生成等 |

### 组件 (`src/components/project/`)

| 组件 | 说明 |
|------|------|
| `create-project-dialog.tsx` | 创建项目对话框（选工作区 / 分组 / 项目类型） |
| `import-project-dialog.tsx` | 导入项目对话框（探测 git remote、迁移路径） |
| `group-select.tsx` | 分组下拉选择器（无分组 / 现有组 / 内联新建组） |

### MCP Tools (`src/mcp/tools/project-tools.ts`)

- `list_projects` / `create_project` / `update_project` / `delete_project` / `identify_project`
- `list_product_groups` / `create_product_group` — 产品分组
- `update_project` 支持 `groupId`（`""` 解绑）与 `knowledgeDir` 参数

知识库相关工具在 `src/mcp/tools/knowledge-base-tools.ts`：`ask_project_knowledge` / `manage_project_facts`。

## 约束

- `type` 字段只读，由 `gitUrl` 存在性决定
- 删除项目级联删除所有 Task
- 分组与其成员项目必须同属一个工作区；`createProject` 不接受 `groupId`，需创建后用 `setProjectGroup` 单独绑定
- 删除分组只解绑成员（`groupId = null`），不删除项目
