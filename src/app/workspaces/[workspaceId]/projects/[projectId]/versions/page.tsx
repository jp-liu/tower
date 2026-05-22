import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectVersions, getVersionDiffStat } from "@/actions/version-actions";
import { VersionTimelineClient } from "./version-timeline-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ workspaceId: string; projectId: string }>;
}

export default async function VersionsPage({ params }: Props) {
  const { workspaceId, projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, workspaceId: true, localPath: true },
  });

  if (!project || project.workspaceId !== workspaceId) notFound();

  const versions = await getProjectVersions(projectId);

  // Fetch version-level diff stats in parallel
  const diffEntries = await Promise.all(
    versions.map(async (v) => [v.id, await getVersionDiffStat(v.id)] as const)
  );
  const diffStats = Object.fromEntries(diffEntries);

  // History bucket: tasks with no version
  const backlog = await db.task.findMany({
    where: { projectId, versionId: null },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    include: {
      labels: { include: { label: true } },
      assets: { select: { id: true, filename: true, mimeType: true, size: true } },
      notes: { select: { id: true, title: true, category: true } },
    },
  });

  return (
    <VersionTimelineClient
      project={{ id: project.id, name: project.name, localPath: project.localPath }}
      versions={versions}
      diffStats={diffStats}
      backlog={backlog}
    />
  );
}
