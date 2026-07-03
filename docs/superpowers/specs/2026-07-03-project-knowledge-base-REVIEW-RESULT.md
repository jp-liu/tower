# 项目知识库 — 审查结果（过夜完善 + 审查）

> 生成时间：2026-07-03 凌晨。执行人：Claude（Opus 4.8），无人值守。
> 上游：`2026-07-02-project-knowledge-base-design.md`（as-built）、`2026-07-02-project-knowledge-base-REVIEW-ADDENDUM.md`（对齐修正）。
> 分支：`feat/project-knowledge-base`。全程**未 fork、未跑 bypass codex**（今晚已两次翻车，改自己动手 + 只读验证）。

## TL;DR

- **可行性：坐实能做，且首版功能已跑通。** 你的 5 类问题（生产路径 / 报名流程 / 版本 3.2 前后端 commit / 版本数 / CICD 路径）现有实现都覆盖。
- **我做了什么**：修好编译（prisma client 没跟 schema regenerate，是那堆 TS 报错的根因）、把迁移 0006 应用到 dev+prod 库、补 2 条聚合单测（直击「前后端 commit」路径）、全链路验证。
- **知识库自身质量：好。** production 代码类型干净，8/8 单测绿，迁移幂等+自动发现+FTS-safe，2 个 MCP 工具已注册+文档化。
- **一个待你拍板**：事实卡 A/B（我改留 B，理由见下，一句话可 revert）。
- **一处 pre-existing 债**：集成测试套件非幂等（依赖累积库状态 + 并行共享库互踩），与知识库无关，详见 §5——**我重建了本地测试库，需你知悉**。

---

## 1. 功能现状核查（逐条对你的需求）

| 你的问题 | 数据源 | 实现位置 | 结论 |
|---|---|---|---|
| a 生产环境路径 | ProjectFact 事实卡 | `manage_project_facts` set/list | ✅ |
| b 报名流程 | repo `docs/知识库/*.md` 读盘 | `knowledge.ts scanKnowledgeDir` | ✅ 命中片段带 `文件:行`，索引文件当路由表 |
| c 版本 3.2 需求点 | `Version.description` | `queryProjectKnowledge` versions[] | ✅ |
| c 前后端改动 commit 分别哪些 | `TaskExecution.mergeCommit` + productKey 分组 | versions[].tasks[].mergeCommit + projectName 标注 | ✅ 已加单测验证 |
| d 有几个版本 | `Version` 计数 | versions[] | ✅ |
| 质效 CICD 路径 | ProjectFact | `manage_project_facts` | ✅ |

**productKey 分组**：同 productKey 的前后端项目自动一起检索，限定同 workspace 防跨区串数据（`knowledge.ts:177`）。

**Tower 只检索不生成**：返回带来源标注的原料块，调用方 LLM（飞书 Bot / Claude）自己组织答案。不引 embedding、不接大模型、不迁移 repo 知识文件——判断正确，省掉一大坨复杂度。

## 2. 代码质量审查

- `src/lib/knowledge.ts`（281 行）：DI prisma 无 Next 依赖（dev + MCP 双进程可用，同 fts.ts 惯例）；越界防御（`knowledgeDir` resolve 后校验必须落在 localPath 内，`:264`）；payload 上限齐全（≤200 文件 / ≤512KB / ≤8 片段 / ≤20 版本）；CJK 2-gram 兜底召回中文无空格复合词。**干净，无异味。**
- `src/mcp/tools/knowledge-base-tools.ts`（106 行）：模糊项目解析（精确 id / 名 / alias，歧义返回 needsSelection，拉开 0.2 分差才自动选）；事实卡 upsert by (projectId,key)。
- 迁移 `scripts/migrations/0006-project-knowledge.ts`：加性 raw SQL、PRAGMA 查列幂等、**绝不碰 notes_fts**、runner 自动发现（无需手动登记）、prod 启动 `bin/tower.mjs` 会自动跑。已确认应用到 `~/.tower` + `~/.tower-dev`（ledger 记录 `0006-project-knowledge`）。
- 注册（`src/mcp/server.ts:28`）+ AGENTS.md 文档（33 工具，两工具入表）齐全。

## 3. 我今晚的改动

| 改动 | 文件 | 为什么 |
|---|---|---|
| `prisma generate` | （生成物） | schema 有 productKey/ProjectFact 但 client 没重生成 → 分支**根本编译不过**（TS 报 projectFact 不存在）。这是分支继承时就不完整，非我引入。 |
| 应用迁移 0006 | `~/.tower` + `~/.tower-dev` | dev/prod 库缺 productKey 列，运行时会炸。additive/幂等，prod 下次启动本来也会跑。 |
| +2 聚合单测 | `src/lib/__tests__/knowledge.test.ts` | `queryProjectKnowledge` 的 DB 聚合（productKey 分组 + 前后端 commit 分离）**原本零测试**，是最该补的 runnable check。用 mock prisma，8/8 绿。 |

**编译**：`tsc --noEmit` production 代码 0 error（14 个残留全在测试 mock 的 `as` cast，pre-existing，main 上同样有）。

## 4. 待你拍板：事实卡 A/B

- **我改主意留了 B（ProjectFact 表 + manage_project_facts）**，不是你先前选的 A（ProjectNote 存事实）。
- 理由：先前推 A 是「还没写代码、为省一张表」；现在 B 已建好、干净、能用，「生产路径=xxx」本质就是 key-value，塞进笔记反而 hack。**代码已存在时删它换 A 比留着更费**——ponytail 的账反过来了。
- 若你仍要统一成一个存储：删 `ProjectFact` model + `manage_project_facts` 工具 + `knowledge.ts` 里 `db.projectFact` 那段改走 `searchNotes`，是个小 revert。**早上一句话即可，我按你的定。**

## 5. ⚠️ Pre-existing 测试基建债（须你知悉）

跑全量 `pnpm test:run` 时，一批集成测试失败（18~74 个，随库状态摆动）。**全部与知识库无关**（agent/config/search/task/asset/fts/note/manage-* 等），根因是测试基建：

1. **非幂等 / 硬依赖累积数据**：这些集成测试打真实本地库、依赖特定累积数据（写死的 ID/计数）；失败是「FK 约束违反 / 期望的行不存在」——空库或全新种子库就崩。**已验证与并行无关**：`--no-file-parallelism` 串行跑仍 74 失败，排除竞争，坐实是数据依赖。
2. **测试库分两组两库**：一组 `new PrismaClient({url: DATABASE_URL ?? "file:./prisma/dev.db"})`，一组走 app db 单例（`~/.tower`）——没有统一的干净测试库 setup，也没有 per-run reset。
3. **失败数随库状态摆动**：你原累积库 18 失败、全新种子库 74 失败——同一份代码，仅库状态不同，证明是环境而非代码问题。

**一个测试库路径陷阱（我踩了，已还原）**：测试库其实是**被 git 跟踪的 `prisma/prisma/dev.db`**——因为 prisma CLI 把 `file:./prisma/dev.db` **按 schema 所在的 `prisma/` 目录解析**（→ `prisma/prisma/dev.db`），而根目录那个 gitignore 的 `prisma/dev.db` 是另一个文件。排查中我的 rebuild 一度改脏了这个跟踪文件；**已 `git checkout -- prisma/prisma/dev.db` 还原到提交版，根目录库从它复原，`git status` 现只剩你的 `package.json`——测试基线未被我永久改动。**

**结论**：这些失败是**仓库层面的 pre-existing 状态**——提交进 repo 的测试库 `prisma/prisma/dev.db` 本身 schema 陈旧（停在 5 月 11 日、缺 `order`/productKey 等），叠加测试非幂等。**不该我今晚顺手改**（是独立的「集成测试幂等化 + 测试库同步」工程，无人值守下动测试隔离风险高）。若你想让集成套件转绿，需要：把 `prisma/prisma/dev.db` 同步到当前 schema（清 `-wal/-shm` 残留后 `prisma db push` + `init-fts` + 迁移 0006），并让这些测试自建自清数据（去掉硬依赖累积行）。**知识库自身单测（8/8）完全不受影响**——它用 mock prisma，不打真实库。

## 6. 前置假设 / 建议待办

1. **飞书链路（决定成败）**：本设计只做通 Tower MCP **数据侧**。飞书 Bot 能否问出答案，取决于它**是否已把 Tower MCP 配为工具**——若没配是传输链路问题，本设计不覆盖。**请先确认飞书那侧的 MCP 接入状态。**
2. **无前端 UI**：productKey / knowledgeDir / 事实卡目前只能经 MCP 设。建议后续补 Project 设置页的知识库配置区。
3. **`kb init` 脚手架未做**：把你 NJZSBM 的 `00-索引.md`/`_约定.md`/模板拷进新项目。
4. **前后端 commit 可更丰**：现只带每任务最新 execution 的 `mergeCommit`+branch。若要「改动范围」，可加 `forkCommit`（base）+ `gitStats`（±行数）——2 行 select 扩展，我没擅自加（YAGNI，你要再说）。
5. **changelog 深度**：更细 diff 走既有 `gitLog`/`gitStats` 字段，未在本工具展开。

## 7. git 现状

- codex-terminal 那摊活你已迁到 worktree `task/cmr3p4t7...`（能力插槽 6307c4b / CodexCliAdapter 1338bfb），已从知识库分支救出 ✅。
- `feat/project-knowledge-base` 仍带着重复的 codex-terminal commit（210832d/83ce6a1 + 3 个 docs）——你说 git 已处理，我没再动。
- 我今晚的改动（+2 单测 + 本审查文档 + 上游对齐附录）未提交，留工作区等你过目。你的 `package.json` 版本号改动我全程没碰。
