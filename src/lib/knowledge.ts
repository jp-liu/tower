// src/lib/knowledge.ts — NO Next.js imports.
// 项目知识库检索/聚合层。接收 PrismaClient 作参数（DI），dev server action 与
// MCP stdio 进程都能用（同 fts.ts 惯例）。
//
// 设计判断：Tower 只做「检索 + 聚合」，不生成答案。调用方（飞书机器人 / Claude /
// 任何配了 Tower MCP 的 agent）本身就是 LLM，拿到聚合原料后自己组织答案。
// → 不引 embedding、不在 Tower 里接大模型、不迁移 repo 里的知识文件。
//
// 四个源并联：
//   1. 知识文件  repo <localPath>/<knowledgeDir>/*.md   （读盘 + JS 逐行匹配，零外部依赖）
//   2. 事实卡    ProjectFact                             （生产/CICD 路径等，全量返回，量小）
//   3. 版本/commit  Version + Task + TaskExecution        （版本数、需求点、前后端 commit、changelog）
//   4. DB 笔记   ProjectNote (notes_fts)                  （任务派生轻笔记，FTS）
//
// productKey 同组的兄弟项目（前后端）自动一起检索。

import type { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import { join, relative } from "path";
import { searchNotes } from "./fts";

/** 约定默认知识库目录（相对 localPath）。项目可用 Project.knowledgeDir 覆盖。 */
export const DEFAULT_KNOWLEDGE_DIR = "docs/知识库";

const MAX_FILES_SCANNED = 200; // 防御：知识目录异常巨大时兜底
const MAX_FILE_BYTES = 512 * 1024; // 单文件超 512KB 跳过（知识 md 不该这么大）
const MAX_SNIPPETS_PER_FILE = 8;
const MAX_MATCHED_FILES = 8;
const INDEX_HEAD_LINES = 60; // 索引文件当路由表，带前 N 行
const MAX_TASKS_PER_VERSION = 40;

export interface KnowledgeResult {
  query: string;
  projects: Array<{
    projectId: string;
    name: string;
    productKey: string | null;
    knowledgeDir: string;
    localPath: string | null;
  }>;
  facts: Array<{ projectName: string; key: string; value: string }>;
  versions: Array<{
    projectName: string;
    number: string;
    name: string;
    status: string;
    isCurrent: boolean;
    description: string | null;
    baseCommit: string | null;
    releaseCommit: string | null;
    releasedAt: Date | null;
    tasks: Array<{ title: string; status: string; mergeCommit: string | null; branch: string | null }>;
  }>;
  knowledgeFiles: Array<{
    projectName: string;
    file: string;
    hits: number;
    snippets: Array<{ line: number; text: string }>;
  }>;
  indexes: Array<{ projectName: string; file: string; content: string }>;
  notes: Array<{ projectName: string; title: string; snippet: string }>;
  warnings: string[];
}

/** 把查询拆成检索词：空白分词 + 保留原短语。CJK 短语直接子串匹配。 */
export function queryTerms(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const terms = new Set<string>([q.toLowerCase()]);
  for (const t of tokens) terms.add(t.toLowerCase());
  return [...terms];
}

/** 递归列出目录下的 .md 文件（跳过 node_modules/.git，限深度与总数）。 */
async function listMarkdown(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listMarkdown(full, depth + 1)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
    if (out.length >= MAX_FILES_SCANNED) break;
  }
  return out;
}

function isIndexFile(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("索引") || n.includes("index") || /(^|\/)00[-_.]/.test(n) || n.includes("导读");
}

/** 扫一个项目的知识目录，返回命中文件片段 + 索引文件全文（路由表）。 */
export async function scanKnowledgeDir(
  root: string,
  terms: string[]
): Promise<{
  files: Array<{ file: string; hits: number; snippets: Array<{ line: number; text: string }> }>;
  indexes: Array<{ file: string; content: string }>;
}> {
  const paths = await listMarkdown(root);
  const files: Array<{ file: string; hits: number; snippets: Array<{ line: number; text: string }> }> = [];
  const indexes: Array<{ file: string; content: string }> = [];

  for (const path of paths) {
    let content: string;
    try {
      const stat = await fs.stat(path);
      if (stat.size > MAX_FILE_BYTES) continue;
      content = await fs.readFile(path, "utf8");
    } catch {
      continue;
    }
    const rel = relative(root, path);

    if (isIndexFile(rel)) {
      indexes.push({ file: rel, content: content.split("\n").slice(0, INDEX_HEAD_LINES).join("\n") });
    }

    const lines = content.split("\n");
    const snippets: Array<{ line: number; text: string }> = [];
    let hits = 0;
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      const matched = terms.some((t) => low.includes(t));
      if (matched) {
        hits++;
        if (snippets.length < MAX_SNIPPETS_PER_FILE) {
          snippets.push({ line: i + 1, text: lines[i].trim().slice(0, 300) });
        }
      }
    }
    if (hits > 0) files.push({ file: rel, hits, snippets });
  }

  files.sort((a, b) => b.hits - a.hits);
  return { files: files.slice(0, MAX_MATCHED_FILES), indexes };
}

/**
 * 聚合一个项目（含 productKey 同组兄弟）的知识，供调用方 LLM 组织答案。
 */
export async function queryProjectKnowledge(
  db: PrismaClient,
  projectId: string,
  query: string
): Promise<KnowledgeResult> {
  const terms = queryTerms(query);
  const warnings: string[] = [];

  const anchor = await db.project.findUnique({ where: { id: projectId } });
  if (!anchor) throw new Error(`Project not found: ${projectId}`);

  // 产品组：同 productKey 的兄弟项目一起检索（前后端）。
  const group = anchor.productKey
    ? await db.project.findMany({ where: { productKey: anchor.productKey } })
    : [anchor];

  const result: KnowledgeResult = {
    query,
    projects: group.map((p) => ({
      projectId: p.id,
      name: p.name,
      productKey: p.productKey,
      knowledgeDir: p.knowledgeDir || DEFAULT_KNOWLEDGE_DIR,
      localPath: p.localPath,
    })),
    facts: [],
    versions: [],
    knowledgeFiles: [],
    indexes: [],
    notes: [],
    warnings,
  };

  for (const p of group) {
    // 1. 事实卡（全量，量小，高价值）
    const facts = await db.projectFact.findMany({ where: { projectId: p.id }, orderBy: { key: "asc" } });
    for (const f of facts) result.facts.push({ projectName: p.name, key: f.key, value: f.value });

    // 2. 版本 + 任务 + execution commit（changelog / 前后端 commit）
    const versions = await db.version.findMany({
      where: { projectId: p.id },
      orderBy: [{ isCurrent: "desc" }, { order: "asc" }, { createdAt: "desc" }],
      include: {
        tasks: {
          take: MAX_TASKS_PER_VERSION,
          select: {
            title: true,
            status: true,
            executions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { mergeCommit: true, branch: true, worktreeBranch: true },
            },
          },
        },
      },
    });
    for (const v of versions) {
      result.versions.push({
        projectName: p.name,
        number: v.number,
        name: v.name,
        status: v.status,
        isCurrent: v.isCurrent,
        description: v.description,
        baseCommit: v.baseCommit,
        releaseCommit: v.releaseCommit,
        releasedAt: v.releasedAt,
        tasks: v.tasks.map((t) => ({
          title: t.title,
          status: t.status,
          mergeCommit: t.executions[0]?.mergeCommit ?? null,
          branch: t.executions[0]?.branch ?? t.executions[0]?.worktreeBranch ?? null,
        })),
      });
    }

    // 3. DB 笔记（FTS）
    try {
      const notes = await searchNotes(db, p.id, query);
      for (const n of notes.slice(0, 10)) {
        result.notes.push({ projectName: p.name, title: n.title, snippet: n.content.slice(0, 400) });
      }
    } catch (e) {
      warnings.push(`notes search failed for ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 4. 知识文件（读盘）
    if (!p.localPath) {
      warnings.push(`${p.name}: 无 localPath，跳过知识文件检索`);
      continue;
    }
    const dir = join(p.localPath, p.knowledgeDir || DEFAULT_KNOWLEDGE_DIR);
    // 单次扫描：索引文件（路由表）与查询词无关，总是收集；命中片段按 terms 匹配。
    const { files, indexes } = await scanKnowledgeDir(dir, terms);
    for (const f of files) {
      result.knowledgeFiles.push({ projectName: p.name, file: f.file, hits: f.hits, snippets: f.snippets });
    }
    for (const i of indexes) result.indexes.push({ projectName: p.name, file: i.file, content: i.content });
    if (files.length === 0 && indexes.length === 0) {
      warnings.push(`${p.name}: 知识目录 ${p.knowledgeDir || DEFAULT_KNOWLEDGE_DIR} 无匹配或不存在`);
    }
  }

  return result;
}
