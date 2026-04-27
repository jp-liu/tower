"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Search, Settings, Plus, Command, Globe, FolderOpen, Bot, Sun, Moon } from "lucide-react";
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
}

interface TopBarProps {
  onCreateProject?: (data: CreateProjectData) => Promise<{ id: string } | void> | { id: string } | void;
  username?: string | null;
}

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

        const transition = (document as any).startViewTransition(() => {
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

export function TopBar({ onCreateProject, username }: TopBarProps) {
  const { t, locale, setLocale } = useI18n();
  const { isOpen: assistantOpen, toggleAssistant } = useAssistant();
  const { resolvedTheme, toggleTheme, triggerRef } = useThemeTransition();
  const router = useRouter();
  const [showSearch, setShowSearch] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showImportProject, setShowImportProject] = useState(false);

  // Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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

          {/* Divider */}
          <div className="h-4 w-px bg-border" />

          <Button
            variant="outline"
            className="gap-1.5 ring-1 ring-border hover:bg-accent"
            onClick={() => setShowImportProject(true)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("topbar.importProject")}
          </Button>

          <Button
            data-tour="create-project"
            className="gap-1.5 bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
            onClick={() => setShowCreateProject(true)}
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
        open={showCreateProject}
        onOpenChange={setShowCreateProject}
        onCreateProject={onCreateProject}
      />

      {/* Import Project Dialog */}
      <ImportProjectDialog
        open={showImportProject}
        onOpenChange={setShowImportProject}
        onCreateProject={onCreateProject}
      />
    </>
  );
}
