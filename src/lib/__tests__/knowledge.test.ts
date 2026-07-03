import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { queryTerms, scanKnowledgeDir, queryProjectKnowledge } from "../knowledge";

describe("queryTerms", () => {
  it("keeps the full phrase and splits whitespace tokens", () => {
    expect(queryTerms("报名 流程")).toEqual(expect.arrayContaining(["报名 流程", "报名", "流程"]));
  });
  it("drops <2-char tokens but keeps the phrase", () => {
    expect(queryTerms("a bb")).toEqual(["a bb", "bb"]);
  });
  it("blank → empty", () => {
    expect(queryTerms("   ")).toEqual([]);
  });
  it("无空格 CJK 复合词切 2-gram 兜底召回", () => {
    const t = queryTerms("生产环境路径");
    expect(t).toContain("生产环境路径"); // 整串
    expect(t).toEqual(expect.arrayContaining(["生产", "环境", "路径"])); // bigram
  });
});

describe("scanKnowledgeDir", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "kb-test-"));
    await fs.writeFile(join(dir, "00-索引.md"), "# 索引\n- 报名流程 见 01\n更多内容行占位\n", "utf8");
    await fs.writeFile(
      join(dir, "01-主流程.md"),
      "报名开始\n用户填写信息\n审核通过后报名成功\n无关行\n",
      "utf8"
    );
    await fs.writeFile(join(dir, "02-其他.md"), "完全无关的内容\n", "utf8");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("matches lines by term, ranks by hits, always returns the index file", async () => {
    const { files, indexes } = await scanKnowledgeDir(dir, ["报名"]);
    // 索引文件总是被当路由表返回
    expect(indexes.map((i) => i.file)).toContain("00-索引.md");
    // 01 命中 2 行(报名开始/报名成功) 应排在命中文件首位
    expect(files[0].file).toBe("01-主流程.md");
    expect(files[0].hits).toBe(2);
    // 02 无命中 → 不在结果里
    expect(files.map((f) => f.file)).not.toContain("02-其他.md");
    // 片段带行号
    expect(files[0].snippets[0].line).toBe(1);
  });

  it("no terms → no matched files but index still returned", async () => {
    const { files, indexes } = await scanKnowledgeDir(dir, []);
    expect(files).toHaveLength(0);
    expect(indexes.length).toBeGreaterThan(0);
  });
});

describe("queryProjectKnowledge — 聚合与产品组分组", () => {
  // 前后端两项目同属一个 ProductGroup（groupId），各带版本 3.2 + 其 mergeCommit + 事实卡。
  // localPath 留空 → 跳过文件扫描（本用例专测 DB 聚合，不碰磁盘）。
  const web = {
    id: "p_web", name: "acme-web", groupId: "g_acme", workspaceId: "ws1",
    localPath: null, knowledgeDir: null,
  };
  const api = {
    id: "p_api", name: "acme-api", groupId: "g_acme", workspaceId: "ws1",
    localPath: null, knowledgeDir: null,
  };
  const versionsByProject: Record<string, unknown[]> = {
    p_web: [{
      number: "3.2", name: "报名优化", status: "IN_PROGRESS", isCurrent: true, order: 0,
      description: "前端报名流程重构", baseCommit: null, releaseCommit: null, releasedAt: null,
      tasks: [{ title: "报名页", status: "DONE",
        executions: [{ mergeCommit: "webabc", branch: "feat/web", worktreeBranch: null }] }],
    }],
    p_api: [{
      number: "3.2", name: "报名优化", status: "IN_PROGRESS", isCurrent: true, order: 0,
      description: "后端报名接口", baseCommit: null, releaseCommit: null, releasedAt: null,
      tasks: [{ title: "报名接口", status: "DONE",
        executions: [{ mergeCommit: "apixyz", branch: "feat/api", worktreeBranch: null }] }],
    }],
  };
  const factsByProject: Record<string, Array<{ key: string; value: string }>> = {
    p_web: [{ key: "生产环境路径", value: "https://acme.com" }],
    p_api: [{ key: "CICD路径", value: "gitlab/acme/api" }],
  };

  const db = {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "p_web" ? web : where.id === "p_api" ? api : null,
      findMany: async ({ where }: { where: { groupId: string } }) =>
        [web, api].filter((p) => p.groupId === where.groupId),
    },
    projectFact: {
      findMany: async ({ where }: { where: { projectId: string } }) => factsByProject[where.projectId] ?? [],
    },
    version: {
      findMany: async ({ where }: { where: { projectId: string } }) => versionsByProject[where.projectId] ?? [],
    },
    // searchNotes 走 FTS → $queryRawUnsafe；本用例无笔记，返回空。
    $queryRawUnsafe: async () => [],
  } as unknown as PrismaClient;

  it("同产品组的前后端项目一起检索，版本 commit 按项目分开", async () => {
    const res = await queryProjectKnowledge(db, "p_web", "版本 3.2 commit");

    // 前后端两项目都进组
    expect(res.projects.map((p) => p.name).sort()).toEqual(["acme-api", "acme-web"]);

    // 「前后端改动 commit 分别是哪些」——版本按 projectName 分开，各带 mergeCommit
    const webV = res.versions.find((v) => v.projectName === "acme-web" && v.number === "3.2");
    const apiV = res.versions.find((v) => v.projectName === "acme-api" && v.number === "3.2");
    expect(webV?.tasks[0]?.mergeCommit).toBe("webabc");
    expect(apiV?.tasks[0]?.mergeCommit).toBe("apixyz");

    // 事实卡跨前后端合并（生产路径来自 web、CICD 来自 api）
    const factKeys = res.facts.map((f) => f.key);
    expect(factKeys).toContain("生产环境路径");
    expect(factKeys).toContain("CICD路径");
  });

  it("无产品组时只查自己，不牵连兄弟", async () => {
    const solo = { ...web, groupId: null };
    const soloDb = {
      ...(db as unknown as Record<string, unknown>),
      project: {
        findUnique: async () => solo,
        findMany: async () => { throw new Error("不该按组查"); },
      },
    } as unknown as PrismaClient;
    const res = await queryProjectKnowledge(soloDb, "p_web", "x");
    expect(res.projects.map((p) => p.name)).toEqual(["acme-web"]);
  });
});
