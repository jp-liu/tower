# 项目知识库 + MCP 问答 — 设计与实现记录

状态：**已实现首版**（分支 `feat/project-knowledge-base`）。本文兼作设计说明 + codex review 讨论稿。

## 1. 目标

让 Tower MCP 能回答「关于某个项目」的问题，例如：

- a 项目的生产环境路径是什么？
- b 项目的报名流程是什么样的？
- c 项目版本 3.2 主要需求点是什么？前后端改动 commit 分别是哪些？
- d 项目有几个版本了？质效 CICD 路径是什么？

痛点起源：作者已有一套成熟的、活在 repo 里的编号 markdown 知识库（如 `NJZSBM/.../docs/知识库/`：`00-索引`、功能章 `NN-*`、关系层 `20-26`、应然×实然、落差编号），但飞书机器人问项目信息「根本没通」——**因为这些知识活在项目 repo 文件里，不在 Tower 数据库里，MCP 读不到**。

## 2. 核心判断（贯穿设计）

**Tower 只做「检索 + 聚合」，不生成答案。** 调用方（飞书机器人 / Claude / 任何配了 Tower MCP 的 agent）本身就是 LLM，拿到 Tower 聚合的原料后自己组织答案。

由此推出的三个「不做」：
- 不引 embedding / 向量库（现有 FTS5 trigram 已能搜中文；调用方 LLM 消化原料）
- 不在 Tower 里接大模型
- 不把 repo 里的知识文件迁进数据库（保留 `文件:行` 可回溯性，不与代码脱钩）

## 3. 数据来源（四源融合）

| 源 | 存哪 | 答什么 | 本次改动 |
|---|---|---|---|
| 知识文件 | repo `<localPath>/<knowledgeDir>/*.md` | 报名流程、状态机、落差、应然×实然 | **新增读盘检索** |
| 事实卡 | DB `ProjectFact` (key-value) | 生产环境路径、CICD 路径、域名 | **新增小表** |
| 版本/commit | DB `Version` + `Task` + `TaskExecution` | 版本数、需求点、前后端 commit、changelog | 复用已有数据，新增聚合 |
| DB 笔记 | DB `ProjectNote` (notes_fts) | 任务派生轻笔记 | 复用 `searchNotes` |

**项目关联**：`Project.productKey`（产品组）。前后端 a/b 填同值即成组，问答时兄弟项目自动一起检索——这解决「a、b 是同一产品前后端」。

## 4. 数据模型改动（最小）

```prisma
model Project {
  // ...既有字段...
  productKey   String?   // 产品组：同值成组（前后端一起检索）
  knowledgeDir String?   // repo 内知识库目录，默认 docs/知识库
  facts        ProjectFact[]
  @@index([productKey])
}

model ProjectFact {
  id        String   @id @default(cuid())
  projectId String
  key       String
  value     String
  updatedAt DateTime @updatedAt
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([projectId, key])
  @@index([projectId])
}
```

迁移：`scripts/migrations/0006-project-knowledge.ts`，加性 raw SQL（PRAGMA 查列 + `IF NOT EXISTS`），**绝不碰 notes_fts 虚表**（`prisma db push` 会卡死，见既有 0005 惯例）。已在 dev 库应用成功。

## 5. 检索层

`src/lib/knowledge.ts`（无 Next 依赖，DI prisma，同 `fts.ts` 惯例）：

`queryProjectKnowledge(db, projectId, query) → KnowledgeResult`

- 解析产品组（同 `productKey` 兄弟项目）
- 逐项目并联四源，合并返回结构化原料块（带来源：`文件:行`、版本号、commit、fact key）
- 知识文件检索：**读文件 + JS 逐行子串匹配**（零外部依赖，不依赖 `rg`——prod 用户机不一定有）。索引文件（名字含「索引/index/00-/导读」）无论是否命中都整段返回前 60 行，当路由表给调用方 LLM。
- 防御上限：扫描 ≤200 文件、单文件 ≤512KB、每文件 ≤8 片段、命中文件 ≤8、每版本 ≤40 任务。

## 6. MCP 工具（新增 2 个 → 共 33）

`src/mcp/tools/knowledge-base-tools.ts`：

- **`ask_project_knowledge({ project, question, workspaceId? })`** — project 支持精确 id 或模糊名/alias（歧义返回 `needsSelection`），聚合四源返回原料，调用方组织答案。
- **`manage_project_facts({ action: set|delete|list, projectId, key?, value? })`** — 事实卡 CRUD（set 按 `(projectId,key)` upsert）。

`update_project` 扩展：新增 `productKey` / `knowledgeDir` 入参，可通过 MCP 设置分组与目录。

## 7. 验证

- 单测 `src/lib/__tests__/knowledge.test.ts`：`queryTerms` 分词、`scanKnowledgeDir` 命中排序/索引路由/行号（5 passed）。
- 真实数据端到端：临时项目指向真实 `NJZSBM/.../docs/知识库`，问「报名 分班 流程 状态机」→ 正确返回索引路由表（0-新人导读、00-索引）、按命中排序的知识文件（_落差清单 54、需求对照 53…）、带行号片段、事实卡命中，零 warning。

## 8. 明确未做 / 前置假设（待作者拍板）

1. **飞书链路**：本设计只把 Tower MCP 的**数据侧**做通。飞书机器人能否问出来，取决于它**是否已把 Tower MCP 配为工具**——若未配，那是传输链路问题，本设计不覆盖。→ **前置假设，待确认**。
2. **无 UI**：productKey / knowledgeDir / 事实卡目前只能经 MCP 或 server action 设置，没有 Tower 前端编辑界面。ponytail：先让 MCP 通，UI 后补。
3. **`kb init` 脚手架未做**：把作者现成模板（`00-索引.md`/`_约定.md`/`功能章模板.md`）拷进新项目的能力，留到确认方案后再加。
4. **检索是子串匹配非 FTS**：知识文件走 JS 逐行子串（简单、无依赖、够用）。若知识库涨到几百大文件再考虑接 FTS5 索引磁盘文件。
5. **changelog 深度**：`ask_project_knowledge` 已带每版本任务 + 其 execution 的 mergeCommit/branch，够答「版本 X 前后端 commit」。更细的 diff 统计仍走既有 `gitLog`/`gitStats` 字段，未在本工具展开。

## 9. codex 讨论点

- 一个聚合工具 `ask_project_knowledge` vs 拆成 `search_knowledge`/`get_facts`/`get_changelog` 小工具？（当前选聚合，飞书一问一答一次拿全省事）
- `productKey` 轻量分组 vs 显式 `ProjectRelation` 多对多表？（当前选轻量，YAGNI）
- 子串匹配的召回质量（中文无分词），是否需要 bigram 兜底？
