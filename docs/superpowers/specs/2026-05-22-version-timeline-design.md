# 版本时间线（Version Timeline）设计文档

- **日期**：2026-05-22
- **状态**：设计已定稿，待评审 / 实现
- **模块**：建议新增模块 `version`（提交 scope：`feat(version): ...`），与 `task` / `git` / `assets` 紧密关联
- **范围说明**：本文档仅为设计，不含实现。

---

## 1. 背景与目标

为每个项目引入一条「版本时间线」，把任务按版本归纳，形成 **版本 → 任务 → 资源/笔记** 的树状结构，类似 changelog / 迭代记录。用户可以浏览：每个版本做了哪些任务、每个任务产出的资源与笔记、以及版本相对上一基线的代码改动。

现状数据层级为 `Workspace → Project → Task → Execution`，`ProjectNote` / `ProjectAsset` 已可挂在 Task 上。版本层插入到 **Project 与 Task 之间**，作为任务的分组/里程碑容器。

---

## 2. 数据模型

### 2.1 新增 `Version`（挂在 Project 下）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | cuid | 主键 |
| `number` | String | 版本号，自定义字符串（如 `v1.1`、`v1000.1`） |
| `name` | String | 版本名称（如「导出与权限」） |
| `type` | enum `VersionType` | `FEATURE` 需求开发 / `BUGFIX` bug修复 / `RESEARCH` 需求调研 |
| `status` | enum `VersionStatus` | `PLANNED` 规划中 / `ACTIVE` 进行中 / `RELEASED` 已发布 |
| `isCurrent` | Boolean | 「默认收集」标记，**全项目唯一**（仅一个 Version 可为 true） |
| `baseBranch` | String? | D2：该版本下任务默认 fork 的基线分支 |
| `baseCommit` | String? | 创建版本时基线分支的 HEAD commit，用于版本级 diff 起点 |
| `releaseCommit` | String? | 点「发布」时基线分支的 HEAD commit，diff 终点 |
| `startDate` | DateTime? | 计划起始日期（仅计划用途） |
| `targetDate` | DateTime? | 计划完成/发布日期（如 5.30、6.15），时间线排序依据 |
| `releasedAt` | DateTime? | 实际发布时间，点「发布」时写入 |
| `description` | String? | 版本说明 = changelog 正文 |
| `order` | Int | 排序兜底（默认按 `targetDate` 排，缺失时用 `order` / `createdAt`） |
| `projectId` | FK → Project (cascade) | 所属项目 |
| `createdAt` / `updatedAt` | DateTime | — |

### 2.2 `Task` 改动

- 新增 `versionId String?`（FK → Version，`onDelete: SetNull`）。
- 库层可空（backlog 兜底 / 项目尚无版本时）。
- UI 层：项目**已有版本**时，创建任务必填版本，默认选中 `isCurrent` 版本；编辑任务可切换版本。

### 2.3 资源 / 笔记

- 复用现有 `ProjectNote.taskId` / `ProjectAsset.taskId`，**不新增表**。
- 树的叶子层 = 任务关联的笔记与资源。版本本身的「说明」用 `Version.description` 承载，不引入版本级笔记/资源。

### 2.4 约束

- 每个 Project 同时**至多一个** `isCurrent = true` 的版本。
- `type` 与 `status` 正交：`type` 是分类（需求/bug/调研），`status` 驱动工作流。
- 删除 Version 时任务 `versionId` 置空（回到 backlog/History），不级联删除任务。

---

## 3. 生命周期与工作流

### 3.1 状态机

```
PLANNED(规划中) → ACTIVE(进行中) → RELEASED(已发布)
```

- 全部**手动推进**：日期（`startDate`/`targetDate`）只是计划目标，真实状态由用户操作驱动；点「发布」才置 `RELEASED` 并写 `releasedAt`。
- 可提前创建多个 `PLANNED` 版本（如提前规划 6.15）。

### 3.2 「当前版本」与任务收集

- 同时只有一个 `isCurrent`（通常是当前的 `FEATURE` 进行中版本），作为新任务的**默认收集目标**。
- `BUGFIX` / `PLANNED` 版本可与当前版本**并存**（支持并行）。
- 创建任务：版本选择器默认填 `isCurrent`，不改则进它；改了则进指定版本。给提测版修 bug 时手动选对应 `BUGFIX` 版本。

### 3.3 并行场景示例

某时刻可同时存在：

| 版本 | type | status | 说明 |
|---|---|---|---|
| v1.0.x | BUGFIX | ACTIVE | v1.0 提测后修 bug，从 `release/v1.0` fork |
| v1.1 | FEATURE | ACTIVE + isCurrent | 5.30 交付，默认收集新需求 |
| v1.2 | RESEARCH/FEATURE | PLANNED | 6.15 交付，提前规划 |

仅 `isCurrent` 版本默认收集，故新任务归属永不歧义。

### 3.4 发布流程

1. 在当前版本（`isCurrent`，`ACTIVE`）点「发布」。
2. 系统检查该版本下**未完成（非 DONE）**任务 → 自动滚动到「下一个当前版本」。
3. 用户指定下一个当前版本：选一个已有的 `PLANNED`/`ACTIVE` 版本设为 `isCurrent`，或新建一个。
4. 被发布版本：`status → RELEASED`、写 `releasedAt`、写 `releaseCommit`（可选打 git tag）。
5. 该版本仅保留 DONE 任务，成为时间线上一条 changelog 记录。

---

## 4. Git 集成（D2 + 版本级 diff）

- 版本带 `baseBranch`；该版本下任务**默认从该分支 fork**（任务仍可单独覆盖 `baseBranch`）。
- 不同 type 天然对应不同基线：`BUGFIX` 从稳定分支（如 `release/v1.0`）、`FEATURE` 从 `main`/`develop`。
- **版本级 diff**：
  - 创建版本时记录 `baseCommit` = 基线分支当前 HEAD。
  - 发布时记录 `releaseCommit` = 基线分支当时 HEAD。
  - 版本改动 = `baseCommit..releaseCommit`（基线分支区间）。进行中版本可实时算 `baseCommit..当前HEAD` 显示「目前积累了多少改动」。
- 任务之间各自 worktree/分支行为不变，版本只统一规定「从哪来、往哪合」与 diff 区间。
- 复用现有 `TaskExecution.forkCommit/mergeCommit/branchTipCommit` 与 worktree 机制，不改任务级 git 流程。

---

## 5. 视图与交互（单一时间线视图）

- **不做双视图**：仅时间线/列表形式（脑图方案评估后放弃）。
- 项目页新增「版本/迭代」入口，呈现竖向时间线：
  - 按 `targetDate` 排序：未来/进行中在上，已发布按 `releasedAt` 倒序在下。
  - **版本卡**：版本号(mono) · 名称 · type 徽章 · status 徽章 · 当前标记 · 任务计数；meta 行：计划日期 / 基线分支 / 基线 commit / diff 统计（已发布版显示「查看版本 diff」入口）。
  - 展开版本 → 任务列表（状态点 + 优先级 + label）→ 展开任务 → 资源 + 笔记。
- **当前版本高亮**：indigo 左强调条 + 卡头淡色底 + 实心「当前 · 默认收集」徽标；时间线节点用 indigo 实心 + 柔光环，区别于其它进行中版本的绿点。
- **History**：底部归档组，收纳无版本（`versionId = null`）的历史任务，可手动拖入版本。
- 图标统一使用 SVG（Lucide 风格），不用 emoji。
- 所有用户可见文案 zh/en 双语（`t("key")`）。
- 视觉以原型 `version-timeline-mockup-v2.html` 为准。

---

## 6. 不在本期范围 / 未来扩展

- 双视图（脑图 / Git 路线图）——已评估放弃。
- 版本级 diff 的可视化查看器（本期记录 commit 区间 + 统计，详细 diff 浏览可后续接 Monaco/已有 git diff 能力）。
- 真·多个「进行中」并行开发线（当前用单 `isCurrent` + 并存的 BUGFIX/PLANNED 覆盖绝大多数场景）。
- 版本级笔记/资源（本期仅 `description`）。

---

## 7. 待确认 / 风险

- 「下一个当前版本」在发布时若不存在，需引导用户新建（避免无收集目标）。
- 项目尚无任何版本时，任务进 backlog；首次建版本后再引导归类。
- `number` 为自由字符串，不强制 semver，排序以 `targetDate`/`order` 为准而非版本号解析。
