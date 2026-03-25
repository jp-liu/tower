"use client";

import { useRouter } from "next/navigation";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { createProject, createWorkspace } from "@/actions/workspace-actions";

interface LayoutClientProps {
  workspaces: Array<{ id: string; name: string; description: string | null; updatedAt: Date }>;
  children: React.ReactNode;
}

export function LayoutClient({ workspaces, children }: LayoutClientProps) {
  const router = useRouter();

  const handleCreateProject = async (data: { name: string; alias?: string; description?: string; type: "NORMAL" | "GIT"; gitUrl?: string }) => {
    let workspaceId: string;
    if (workspaces.length > 0) {
      workspaceId = workspaces[0].id;
    } else {
      const ws = await createWorkspace({ name: "默认工作空间" });
      workspaceId = ws.id;
    }
    await createProject({ ...data, workspaceId });
    router.refresh();
    router.push(`/workspaces/${workspaceId}`);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar workspaces={workspaces} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onCreateProject={handleCreateProject} />
        <main className="flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
