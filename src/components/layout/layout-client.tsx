"use client";

import { useRouter, usePathname } from "next/navigation";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { TerminalPortalProvider } from "@/components/task/terminal-portal";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { createProject, createWorkspace } from "@/actions/workspace-actions";

interface LayoutClientProps {
  workspaces: Array<{ id: string; name: string; description: string | null; updatedAt: Date }>;
  children: React.ReactNode;
}

export function LayoutClient({ workspaces, children }: LayoutClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeWorkspaceId = pathname.split("/workspaces/")[1]?.split("/")[0];

  const handleCreateProject = async (data: { name: string; alias?: string; description?: string; gitUrl?: string; localPath?: string; projectType?: "FRONTEND" | "BACKEND" }) => {
    const workspaceId = activeWorkspaceId || (workspaces.length > 0 ? workspaces[0].id : null);
    if (!workspaceId) {
      const ws = await createWorkspace({ name: "Default Workspace" });
      await createProject({ ...data, workspaceId: ws.id });
      router.refresh();
      router.push(`/workspaces/${ws.id}`);
      return;
    }
    await createProject({ ...data, workspaceId });
    router.refresh();
    router.push(`/workspaces/${workspaceId}`);
  };

  // Full-screen pages (no sidebar): task detail, notes, assets, archive
  const isTaskDetailPage = /\/workspaces\/[^/]+\/tasks\/[^/]+/.test(pathname);
  const isSubPage = /\/workspaces\/[^/]+\/(notes|assets|archive)/.test(pathname);

  if (isTaskDetailPage || isSubPage) {
    return (
      <TerminalPortalProvider>
        <div className="flex h-screen flex-col overflow-hidden">
          <TopBar onCreateProject={handleCreateProject} />
          <main className="flex-1 overflow-hidden bg-background">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </TerminalPortalProvider>
    );
  }

  return (
    <TerminalPortalProvider>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar workspaces={workspaces} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onCreateProject={handleCreateProject} />
          <main className="flex-1 overflow-auto bg-background">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </TerminalPortalProvider>
  );
}
