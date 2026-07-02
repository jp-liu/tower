import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { queryTerms, scanKnowledgeDir } from "../knowledge";

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
