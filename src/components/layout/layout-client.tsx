"use client";

import { useState, useEffect } from "react";
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
import { GuidedTour } from "@/components/onboarding/guided-tour";
import { CommandPalette } from "@/components/shortcuts/command-palette";
import { ShortcutHelpDialog } from "@/components/shortcuts/shortcut-help-dialog";
import { useActionShortcut } from "@/lib/shortcuts";
import { getLastProjectId } from "@/lib/workspace-last-project";

interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  gitUrl?: string;
  localPath?: string;
  projectType?: "FRONTEND" | "BACKEND";
  workspaceId?: string;
}

interface LayoutClientProps {
  workspaces: Array<{ id: string; name: string; description: string | null; updatedAt: Date }>;
  isFirstRun: boolean;
  username: string | null;
  children: React.ReactNode;
}

function LayoutInner({
  workspaces,
  isFirstRun,
  username,
  children,
  handleCreateProject,
}: {
  workspaces: LayoutClientProps["workspaces"];
  isFirstRun: boolean;
  username: string | null;
  children: React.ReactNode;
  handleCreateProject: (data: CreateProjectData) => Promise<{ id: string } | void>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isOpen, displayMode, closeAssistant } = useAssistant();

  // Global navigation shortcuts — mounted here at the app-wide layout level so
  // they stay live on every route (AppSidebar is only visually hidden on
  // detail/sub pages, but these live at the layout level regardless).
  // Alt+1..9 → jump to the Nth workspace (event.code: Digit1..Digit9).
  useActionShortcut("global.gotoWorkspace", (e) => {
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return;
    const ws = workspaces[Number(m[1]) - 1];
    if (!ws) return;
    // Mirror the sidebar's normal switch: restore the workspace's last-highlighted
    // project so Alt+N behaves identically to clicking it (falls back to the first
    // project server-side when there's no record).
    const lastProjectId = getLastProjectId(ws.id);
    router.push(lastProjectId ? `/workspaces/${ws.id}?projectId=${lastProjectId}` : `/workspaces/${ws.id}`);
  });

  // Bottom-left panel entries. Resolve the active workspace from the path
  // (works on detail/sub routes too), falling back to the first workspace.
  const activeWorkspaceId = pathname.split("/workspaces/")[1]?.split("/")[0];
  const panelWorkspaceId = activeWorkspaceId || workspaces[0]?.id;
  useActionShortcut("panels.taskManager", () => router.push("/missions"));
  useActionShortcut("panels.assets", () => {
    if (panelWorkspaceId) router.push(`/workspaces/${panelWorkspaceId}/assets`);
  });
  useActionShortcut("panels.notes", () => {
    if (panelWorkspaceId) router.push(`/workspaces/${panelWorkspaceId}/notes`);
  });
  useActionShortcut("panels.archive", () => {
    if (panelWorkspaceId) router.push(`/workspaces/${panelWorkspaceId}/archive`);
  });

  // Redirect to onboarding page on first run
  useEffect(() => {
    if (isFirstRun && !pathname.startsWith("/onboarding")) {
      router.replace("/onboarding");
    }
  }, [isFirstRun, pathname, router]);

  const [showTour, setShowTour] = useState(false);
  const [showNotifBanner, setShowNotifBanner] = useState(false);

  // Show guided tour after onboarding is completed but tour not yet done
  useEffect(() => {
    if (!isFirstRun && !pathname.startsWith("/onboarding")) {
      getConfigValue<boolean>("onboarding.tourCompleted", false).then((done) => {
        if (!done) {
          setShowTour(true);
        } else {
          // Tour already done — show banner if permission not yet decided
          setShowNotifBanner(true);
        }
      });
    }
  }, [isFirstRun, pathname]);

  const handleTourComplete = () => {
    setShowTour(false);
    setShowNotifBanner(true);
  };

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  useEffect(() => {
    getConfigValue<boolean>("notification.enabled", true).then(setNotificationsEnabled);
  }, []);
  const isOnboarding = pathname.startsWith("/onboarding");
  useNotificationListener(notificationsEnabled && !isOnboarding);

  // Onboarding page — render without sidebar/topbar
  if (isOnboarding) {
    return <>{children}</>;
  }

  const isTaskDetailPage = /\/workspaces\/[^/]+\/tasks\/[^/]+/.test(pathname);
  const isSubPage = /\/workspaces\/[^/]+\/(notes|assets|archive|groups)/.test(pathname);

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

  // Detail/sub pages hide the sidebar and let their own inner scroll container
  // handle overflow. Both cases render the SAME tree — only className differs —
  // so React never unmounts <main>{children} (or the assistant panel / portaled
  // terminals) across route changes. See project_layoutinner_double_tree memory.
  const hideSidebar = isTaskDetailPage || isSubPage;

  return (
    <>
      {showNotifBanner && <NotificationPermissionBanner onDismiss={() => setShowNotifBanner(false)} />}
      <div className="flex h-screen overflow-hidden">
        {/* Always mounted; `display:none` when hidden removes it from layout, a11y
            tree, and tab order. `contents` when visible keeps <aside> as the direct
            flex child (no extra layout box). */}
        <div className={hideSidebar ? "hidden" : "contents"}>
          <AppSidebar workspaces={workspaces} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar onCreateProject={handleCreateProject} username={username} workspaces={workspaces} defaultWorkspaceId={activeWorkspaceId} />
          <div className="flex min-w-0 flex-1 overflow-hidden">
            {/* Push sidebar: flex sibling of main, inside content area below TopBar (per RESEARCH.md Pattern 2) */}
            {sidebarPanel}
            <main className={`min-w-0 flex-1 bg-background ${hideSidebar ? "overflow-hidden" : "overflow-auto"}`}>
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
          </div>
        </div>
      </div>
      {dialogPanel}
      {showTour && <GuidedTour onComplete={handleTourComplete} />}
      <CommandPalette />
      <ShortcutHelpDialog />
    </>
  );
}

export function LayoutClient({ workspaces, isFirstRun, username, children }: LayoutClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeWorkspaceId = pathname.split("/workspaces/")[1]?.split("/")[0];

  const handleCreateProject = async (data: CreateProjectData): Promise<{ id: string } | void> => {
    // Dialog's explicit workspace pick wins; fall back to the active/first workspace.
    const workspaceId = data.workspaceId || activeWorkspaceId || (workspaces.length > 0 ? workspaces[0].id : null);
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
        <LayoutInner workspaces={workspaces} isFirstRun={isFirstRun} username={username} handleCreateProject={handleCreateProject}>
          {children}
        </LayoutInner>
      </TerminalPortalProvider>
    </AssistantProvider>
  );
}
