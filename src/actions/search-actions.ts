"use server";

import { db } from "@/lib/db";

export type SearchCategory = "task" | "project" | "repository" | "note" | "asset" | "all";

export type SearchResultType = "task" | "project" | "repository" | "note" | "asset";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  navigateTo: string;
}

interface NoteRawRow {
  note_id: string;
  title: string;
  content: string;
  projectId: string;
  workspaceId: string;
  project_name: string;
  workspace_name: string;
}

function toNoteResult(row: NoteRawRow): SearchResult {
  return {
    id: row.note_id,
    type: "note" as const,
    title: row.title,
    subtitle: `${row.workspace_name} / ${row.project_name}`,
    navigateTo: `/workspaces/${row.workspaceId}?projectId=${row.projectId}`,
  };
}

export async function globalSearch(query: string, category: SearchCategory = "task"): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const q = query.trim();

  if (category === "all") {
    const CAP = 5;
    const [taskRes, projectRes, repoRes, noteRes, assetRes] = await Promise.allSettled([
      globalSearch(q, "task"),
      globalSearch(q, "project"),
      globalSearch(q, "repository"),
      globalSearch(q, "note"),
      globalSearch(q, "asset"),
    ]);
    const collect = (res: PromiseSettledResult<SearchResult[]>) =>
      res.status === "fulfilled" ? res.value.slice(0, CAP) : [];
    return [
      ...collect(taskRes),
      ...collect(projectRes),
      ...collect(repoRes),
      ...collect(noteRes),
      ...collect(assetRes),
    ];
  }

  if (category === "task") {
    const tasks = await db.task.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
        ],
      },
      include: {
        project: {
          include: { workspace: true },
        },
      },
      take: 20,
      orderBy: { updatedAt: "desc" },
    });
    return tasks.map((t) => ({
      id: t.id,
      type: "task" as const,
      title: t.title,
      subtitle: `${t.project.workspace.name} / ${t.project.name}`,
      navigateTo: `/workspaces/${t.project.workspaceId}?projectId=${t.projectId}`,
    }));
  }

  if (category === "project") {
    const projects = await db.project.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { alias: { contains: q } },
          { description: { contains: q } },
        ],
      },
      include: { workspace: true },
      take: 20,
      orderBy: { updatedAt: "desc" },
    });
    return projects.map((p) => ({
      id: p.id,
      type: "project" as const,
      title: p.alias ? `${p.name} (${p.alias})` : p.name,
      subtitle: p.workspace.name,
      navigateTo: `/workspaces/${p.workspaceId}?projectId=${p.id}`,
    }));
  }

  if (category === "repository") {
    const repos = await db.repository.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { path: { contains: q } },
        ],
      },
      include: {
        project: {
          include: { workspace: true },
        },
      },
      take: 20,
    });
    return repos.map((r) => ({
      id: r.id,
      type: "repository" as const,
      title: r.name,
      subtitle: `${r.project.workspace.name} / ${r.project.name} · ${r.branch}`,
      navigateTo: `/workspaces/${r.project.workspaceId}?projectId=${r.projectId}`,
    }));
  }

  if (category === "note") {
    // Short query fallback (< 3 chars): FTS5 trigram needs 3+ chars
    if (q.length < 3) {
      const rows = await db.$queryRawUnsafe<NoteRawRow[]>(
        `SELECT n.id as note_id, n.title, n.content,
                n."projectId", p."workspaceId", p.name as project_name, w.name as workspace_name
         FROM "ProjectNote" n
         JOIN "Project" p ON p.id = n."projectId"
         JOIN "Workspace" w ON w.id = p."workspaceId"
         WHERE n.title LIKE ? OR n.content LIKE ?
         LIMIT 20`,
        `%${q}%`,
        `%${q}%`
      );
      return rows.map(toNoteResult);
    }

    // FTS5 search — catch malformed query and fall back to LIKE
    try {
      const rows = await db.$queryRawUnsafe<NoteRawRow[]>(
        `SELECT f.note_id, f.title, f.content,
                n."projectId", p."workspaceId", p.name as project_name, w.name as workspace_name
         FROM notes_fts f
         JOIN "ProjectNote" n ON n.id = f.note_id
         JOIN "Project" p ON p.id = n."projectId"
         JOIN "Workspace" w ON w.id = p."workspaceId"
         WHERE f.notes_fts MATCH ?
         ORDER BY rank
         LIMIT 20`,
        q
      );
      return rows.map(toNoteResult);
    } catch {
      // Malformed FTS5 query (e.g., unmatched quotes) — fall back to LIKE
      const rows = await db.$queryRawUnsafe<NoteRawRow[]>(
        `SELECT n.id as note_id, n.title, n.content,
                n."projectId", p."workspaceId", p.name as project_name, w.name as workspace_name
         FROM "ProjectNote" n
         JOIN "Project" p ON p.id = n."projectId"
         JOIN "Workspace" w ON w.id = p."workspaceId"
         WHERE n.title LIKE ? OR n.content LIKE ?
         LIMIT 20`,
        `%${q}%`,
        `%${q}%`
      );
      return rows.map(toNoteResult);
    }
  }

  if (category === "asset") {
    const assets = await db.projectAsset.findMany({
      where: {
        OR: [
          { filename: { contains: q } },
          { description: { contains: q } },
        ],
      },
      include: {
        project: {
          include: { workspace: true },
        },
      },
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    return assets.map((a) => ({
      id: a.id,
      type: "asset" as const,
      title: a.filename,
      subtitle: `${a.project.workspace.name} / ${a.project.name}`,
      navigateTo: `/workspaces/${a.project.workspaceId}?projectId=${a.projectId}`,
    }));
  }

  return [];
}
