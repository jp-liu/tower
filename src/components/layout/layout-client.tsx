"use client";

import { useRouter, usePathname } from "next/navigation";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { TerminalPortalProvider } from "@/components/task/terminal-portal";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { createProject, createWorkspace } from "@/actions/workspace-actions";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  gitUrl?: string;
  localPath?: string;
  projectType?: "FRONTEND" | "BACKEND";
}

interface LayoutClientProps {
  workspaces: Array<{ id: string; name: string; description: string | null; updatedAt: Date }>;
  isFirstRun: boolean;
  children: React.ReactNode;
}

function LayoutInner({
  workspaces,
  isFirstRun: _isFirstRun,
  children,
  handleCreateProject,
}: {
  workspaces: LayoutClientProps["workspaces"];
  isFirstRun: boolean;
  children: React.ReactNode;
  handleCreateProject: (data: CreateProjectData) => Promise<{ id: string } | void>;
}) {
  const pathname = usePathname();
  const { isOpen, displayMode, closeAssistant } = useAssistant();

  const isTaskDetailPage = /\/workspaces\/[^/]+\/tasks\/[^/]+/.test(pathname);
  const isSubPage = /\/workspaces\/[^/]+\/(notes|assets|archive)/.test(pathname);

  // Sidebar panel — rendered as flex sibling of main for push layout (UX-02)
  const sidebarPanel =
    isOpen && displayMode === "sidebar" ? <AssistantPanel mode="sidebar" /> : null;

  // Dialog panel — rendered in Dialog component for modal mode (UI-04)
  const dialogPanel =
    displayMode === "dialog" ? (
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) closeAssistant();
        }}
      >
        <DialogContent
          showCloseButton={false}
          style={{
            width: "90vw",
            minWidth: "360px",
            maxWidth: "600px",
            height: "70vh",
            minHeight: "480px",
            maxHeight: "800px",
            padding: 0,
          }}
        >
          <AssistantPanel mode="dialog" />
        </DialogContent>
      </Dialog>
    ) : null;

  if (isTaskDetailPage || isSubPage) {
    return (
      <>
        <div className="flex h-screen overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar onCreateProject={handleCreateProject} />
            <div className="flex flex-1 overflow-hidden">
              {/* Push sidebar: flex sibling of main, inside content area below TopBar */}
              {sidebarPanel}
              <main className="flex-1 overflow-hidden bg-background">
                <ErrorBoundary>{children}</ErrorBoundary>
              </main>
            </div>
          </div>
        </div>
        {dialogPanel}
      </>
    );
  }

  return (
    <>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar workspaces={workspaces} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onCreateProject={handleCreateProject} />
          <div className="flex flex-1 overflow-hidden">
            {/* Push sidebar: flex sibling of main, inside content area below TopBar (per RESEARCH.md Pattern 2) */}
            {sidebarPanel}
            <main className="flex-1 overflow-auto bg-background">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
          </div>
        </div>
      </div>
      {dialogPanel}
    </>
  );
}

export function LayoutClient({ workspaces, isFirstRun, children }: LayoutClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeWorkspaceId = pathname.split("/workspaces/")[1]?.split("/")[0];

  const handleCreateProject = async (data: CreateProjectData): Promise<{ id: string } | void> => {
    const workspaceId = activeWorkspaceId || (workspaces.length > 0 ? workspaces[0].id : null);
    if (!workspaceId) {
      const ws = await createWorkspace({ name: "Default Workspace" });
      const project = await createProject({ ...data, workspaceId: ws.id });
      router.refresh();
      router.push(`/workspaces/${ws.id}`);
      return { id: project.id };
    }
    const project = await createProject({ ...data, workspaceId });
    router.refresh();
    router.push(`/workspaces/${workspaceId}`);
    return { id: project.id };
  };

  return (
    <AssistantProvider>
      <TerminalPortalProvider>
        <LayoutInner workspaces={workspaces} isFirstRun={isFirstRun} handleCreateProject={handleCreateProject}>
          {children}
        </LayoutInner>
      </TerminalPortalProvider>
    </AssistantProvider>
  );
}
