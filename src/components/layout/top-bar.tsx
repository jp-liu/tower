"use client";

import { useState, useCallback, useRef } from "react";
import { useActionShortcut } from "@/lib/shortcuts";
import { useUiDialogStore } from "@/stores/ui-dialog-store";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Search, Settings, Plus, Command, Globe, FolderOpen, Bot, Sun, Moon } from "lucide-react";

// GitHub mark — lucide-react dropped brand icons in v0.488+, inline SVG instead.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12.02c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.34-1.27-1.7-1.27-1.7-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.69.41.36.78 1.05.78 2.12v3.14c0 .31.21.68.79.56A11.52 11.52 0 0 0 23.5 12.02C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchDialog } from "./search-dialog";
import { useI18n } from "@/lib/i18n";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { ImportProjectDialog } from "@/components/project/import-project-dialog";

interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  gitUrl?: string;
  localPath?: string;
  projectType?: "FRONTEND" | "BACKEND";
  workspaceId?: string;
}

interface TopBarProps {
  onCreateProject?: (data: CreateProjectData) => Promise<{ id: string } | void> | { id: string } | void;
  username?: string | null;
  workspaces?: Array<{ id: string; name: string }>;
  defaultWorkspaceId?: string;
}

interface ViewTransitionHandle {
  ready: Promise<void>;
}

type ViewTransitionDocument = Document & {
  startViewTransition: (update: () => void) => ViewTransitionHandle;
};

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/**
 * Toggle theme with View Transition API circle-expand animation.
 * Falls back to instant switch if not supported.
 */
function useThemeTransition() {
  const { resolvedTheme, setTheme } = useTheme();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggleTheme = useCallback(
    (e?: React.MouseEvent<HTMLButtonElement>) => {
      const next = resolvedTheme === "dark" ? "light" : "dark";

      // Use View Transition API if available
      if (
        typeof document !== "undefined" &&
        "startViewTransition" in document &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        const x = e?.clientX ?? window.innerWidth / 2;
        const y = e?.clientY ?? 0;
        const endRadius = Math.hypot(
          Math.max(x, window.innerWidth - x),
          Math.max(y, window.innerHeight - y)
        );

        const transition = (document as ViewTransitionDocument).startViewTransition(() => {
          setTheme(next);
        });

        transition.ready.then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 400,
              easing: "ease-in-out",
              pseudoElement: "::view-transition-new(root)",
            }
          );
        });
      } else {
        setTheme(next);
      }
    },
    [resolvedTheme, setTheme]
  );

  return { resolvedTheme, toggleTheme, triggerRef };
}

export function TopBar({ onCreateProject, username, workspaces, defaultWorkspaceId }: TopBarProps) {
  const { t, locale, setLocale } = useI18n();
  const { isOpen: assistantOpen, toggleAssistant } = useAssistant();
  const { resolvedTheme, toggleTheme, triggerRef } = useThemeTransition();
  const router = useRouter();
  const [showSearch, setShowSearch] = useState(false);

  // Global search shortcut (⌘K / Ctrl+K) via the action registry.
  useActionShortcut("global.search", () => setShowSearch(true));

  // The command palette and top-bar buttons share one dialog state owner.
  const createProjectOpen = useUiDialogStore((s) => s.createProjectOpen);
  const importProjectOpen = useUiDialogStore((s) => s.importProjectOpen);
  const setCreateProjectOpen = useUiDialogStore((s) => s.setCreateProjectOpen);
  const setImportProjectOpen = useUiDialogStore((s) => s.setImportProjectOpen);

  return (
    <>
      <header className="flex h-12 items-center justify-between border-b border-border bg-background/80 px-5 backdrop-blur-sm">
        <div className="w-40" />

        {/* Search + Assistant group */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowSearch(true)}
            className="h-8 w-[400px] justify-start gap-2 bg-muted/50 text-muted-foreground hover:bg-muted"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left" suppressHydrationWarning>{t("topbar.searchPlaceholder")}</span>
            <kbd className="mr-1 flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </Button>

          <Tooltip>
            <TooltipTrigger
              delay={500}
              render={
                <button
                  data-tour="open-assistant"
                  onClick={toggleAssistant}
                  aria-label={t("assistant.iconLabel")}
                  className={[
                    "cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    assistantOpen ? "bg-accent text-foreground" : "",
                  ].join(" ")}
                />
              }
            >
              <Bot className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>{t("assistant.iconLabel")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5">
          {/* Language Toggle */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                  className="text-muted-foreground"
                />
              }
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold">{locale === "zh" ? "EN" : "中"}</span>
            </TooltipTrigger>
            <TooltipContent>{t("settings.language")}</TooltipContent>
          </Tooltip>

          {/* Theme Toggle */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={triggerRef}
                  variant="ghost"
                  size="icon"
                  onClick={toggleTheme}
                  className="text-muted-foreground"
                  aria-label={t("settings.theme")}
                />
              }
            >
              {resolvedTheme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </TooltipTrigger>
            <TooltipContent>{t("settings.theme")}</TooltipContent>
          </Tooltip>

          {/* GitHub repo — issue feedback entry */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    window.open("https://github.com/jp-liu/tower", "_blank", "noopener,noreferrer")
                  }
                  className="text-muted-foreground"
                  aria-label={t("topbar.github")}
                />
              }
            >
              <GithubMark className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>{t("topbar.github")}</TooltipContent>
          </Tooltip>

          {/* Divider */}
          <div className="h-4 w-px bg-border" />

          <Button
            variant="outline"
            className="gap-1.5 ring-1 ring-border hover:bg-accent"
            onClick={() => setImportProjectOpen(true)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("topbar.importProject")}
          </Button>

          <Button
            data-tour="create-project"
            className="gap-1.5 bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
            onClick={() => setCreateProjectOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("topbar.newProject")}
          </Button>

          {/* User Avatar + Dropdown (Settings inside) */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="ml-0.5 flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors hover:bg-accent">
                  {username && (
                    <span className="max-w-[80px] truncate text-xs text-muted-foreground">{username}</span>
                  )}
                  <Avatar className="h-7 w-7 ring-1 ring-border">
                    <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                      {username ? getInitials(username) : "U"}
                    </AvatarFallback>
                  </Avatar>
                </button>
              }
            />
            <DropdownMenuContent align="end" sideOffset={8} className="w-40">
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Settings className="mr-2 h-3.5 w-3.5" />
                {t("settings.title")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Search Dialog */}
      <SearchDialog open={showSearch} onOpenChange={setShowSearch} />

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onCreateProject={onCreateProject}
        workspaces={workspaces}
        defaultWorkspaceId={defaultWorkspaceId}
      />

      {/* Import Project Dialog */}
      <ImportProjectDialog
        open={importProjectOpen}
        onOpenChange={setImportProjectOpen}
        onCreateProject={onCreateProject}
        workspaces={workspaces}
        defaultWorkspaceId={defaultWorkspaceId}
      />
    </>
  );
}
