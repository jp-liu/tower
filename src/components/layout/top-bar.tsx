"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Search, Settings, Plus, Command, Globe, FolderOpen, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

export function TopBar({ onCreateProject, username }: TopBarProps) {
  const { t, locale, setLocale } = useI18n();
  const { isOpen: assistantOpen, toggleAssistant } = useAssistant();
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

        {/* Search + Assistant group — Bot is immediately after search per UI-01 */}
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

          {/* Assistant — per UI-01: immediately after search, before right-side settings area */}
          <Tooltip>
            <TooltipTrigger
              delay={500}
              render={
                <button
                  data-tour="open-assistant"
                  onClick={toggleAssistant}
                  aria-label={t("assistant.iconLabel")}
                  className={[
                    "rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    assistantOpen ? "bg-accent text-foreground" : "",
                  ].join(" ")}
                />
              }
            >
              <Bot className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("assistant.iconLabel")}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5">
          {/* Language Toggle */}
          <Button
            variant="ghost"
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="text-muted-foreground"
            title={t("settings.language")}
          >
            <Globe className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold">{locale === "zh" ? "EN" : "中"}</span>
          </Button>

          {/* Divider */}
          <div className="h-4 w-px bg-border" />

          <Link
            href="/settings"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </Link>
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
          {username && (
            <div className="ml-0.5 flex items-center gap-1.5">
              <span className="max-w-[80px] truncate text-xs text-muted-foreground">{username}</span>
              <Avatar className="h-7 w-7 ring-1 ring-border">
                <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                  {getInitials(username)}
                </AvatarFallback>
              </Avatar>
            </div>
          )}
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
