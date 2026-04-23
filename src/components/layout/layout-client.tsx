"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { TerminalPortalProvider } from "@/components/task/terminal-portal";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { createProject, createWorkspace } from "@/actions/workspace-actions";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NotificationPermissionBanner } from "@/components/notifications/notification-permission-banner";
import { useNotificationListener } from "@/components/notifications/use-notification-listener";
import { getConfigValue } from "@/actions/config-actions";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

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
  lastStep: number;
  username: string | null;
  children: React.ReactNode;
}

function LayoutInner({
  workspaces,
  isFirstRun,
  lastStep,
  username,
  children,
  handleCreateProject,
}: {
  workspaces: LayoutClientProps["workspaces"];
  isFirstRun: boolean;
  lastStep: number;
  username: string | null;
  children: React.ReactNode;
  handleCreateProject: (data: CreateProjectData) => Promise<{ id: string } | void>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isOpen, displayMode, closeAssistant } = useAssistant();

  const [showWizard, setShowWizard] = useState(isFirstRun);
  // Resume at next step after last completed; cap at 2 (max steps)
  const wizardInitialStep = Math.min(lastStep >= 1 ? lastStep + 1 : 1, 2);
  const handleWizardComplete = useCallback(() => {
    setShowWizard(false);
    router.push("/workspaces");
  }, [router]);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  useEffect(() => {
    getConfigValue<boolean>("notification.enabled", true).then(setNotificationsEnabled);
  }, []);
  useNotificationListener(notificationsEnabled);

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
        <NotificationPermissionBanner />
        <div className="flex h-screen overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar onCreateProject={handleCreateProject} username={username} />
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
        {showWizard && <OnboardingWizard onComplete={handleWizardComplete} initialStep={wizardInitialStep} initialUsername={username ?? ""} />}
      </>
    );
  }

  return (
    <>
      <NotificationPermissionBanner />
      <div className="flex h-screen overflow-hidden">
        <AppSidebar workspaces={workspaces} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onCreateProject={handleCreateProject} username={username} />
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
      {showWizard && <OnboardingWizard onComplete={handleWizardComplete} initialStep={wizardInitialStep} initialUsername={username ?? ""} />}
    </>
  );
}

export function LayoutClient({ workspaces, isFirstRun, lastStep, username, children }: LayoutClientProps) {
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
        <LayoutInner workspaces={workspaces} isFirstRun={isFirstRun} lastStep={lastStep} username={username} handleCreateProject={handleCreateProject}>
          {children}
        </LayoutInner>
      </TerminalPortalProvider>
    </AssistantProvider>
  );
}
