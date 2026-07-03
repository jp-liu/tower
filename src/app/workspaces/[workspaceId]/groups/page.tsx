import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProductGroups } from "@/actions/group-actions";
import { GroupsPageClient } from "./groups-page-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function GroupsPage({ params }: Props) {
  const { workspaceId } = await params;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) notFound();

  const [groups, projects] = await Promise.all([
    getProductGroups(workspaceId),
    db.project.findMany({
      where: { workspaceId },
      select: { id: true, name: true, alias: true, groupId: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <GroupsPageClient
      workspaceId={workspaceId}
      initialGroups={groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        projects: g.projects,
      }))}
      allProjects={projects}
    />
  );
}
