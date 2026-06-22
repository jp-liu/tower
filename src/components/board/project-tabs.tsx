"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { getOrCreateTowerTaskId } from "@/actions/workspace-actions";
import { useI18n } from "@/lib/i18n";

interface Project {
  id: string;
  name: string;
  alias: string | null;
  totalTasks: number;
  runningTasks: number;
}

interface ProjectTabsProps {
  projects: Project[];
  activeProjectId: string;
  workspaceId: string;
  onSelect: (projectId: string) => void;
}

const TAB_WIDTH = "w-[212px]";

function ProjectTab({
  project,
  isActive,
  workspaceId,
  onSelect,
}: {
  project: Project;
  isActive: boolean;
  workspaceId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const total = project.totalTasks;
  const running = project.runningTasks;
  const pct = total > 0 ? Math.round((running / total) * 100) : 0;

  // Mirror the tooltip's open state so the tab stays highlighted while the
  // pointer is over the (portalled) tooltip — CSS :hover can't cross the portal.
  const [open, setOpen] = useState(false);
  const [isOpeningStudio, setIsOpeningStudio] = useState(false);

  const openStudio = async () => {
    setIsOpeningStudio(true);
    try {
      const taskId = await getOrCreateTowerTaskId(project.id);
      router.push(`/workspaces/${workspaceId}/tasks/${taskId}`);
    } catch {
      toast.error(t("git.openStudioFailed"));
    } finally {
      setIsOpeningStudio(false);
    }
  };

  const button = (
    <button
      onClick={() => { if (!isActive) onSelect(project.id); }}
      className={`group flex ${TAB_WIDTH} shrink-0 items-center gap-2 rounded-lg border-b-2 px-3 py-1.5 text-left transition-colors ${
        isActive
          ? "border-primary bg-primary/10 ring-1 ring-primary/20 cursor-default"
          : `border-transparent cursor-pointer ${open ? "bg-accent" : "hover:bg-accent"}`
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`w-full truncate text-sm font-medium leading-tight ${
            isActive ? "text-primary" : open ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
          }`}
        >
          {project.name}
        </span>
        {project.alias && (
          <span className="w-full truncate text-[11px] font-normal leading-tight text-muted-foreground/70">
            {project.alias}
          </span>
        )}
      </span>

      {/* running / total badge */}
      <span className="flex shrink-0 items-baseline rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none">
        <span className="text-amber-500 dark:text-amber-400">{running}</span>
        <span className="mx-px text-muted-foreground/50">/</span>
        <span className="text-muted-foreground">{total}</span>
      </span>
    </button>
  );

  return (
    <Tooltip onOpenChange={setOpen}>
      <TooltipTrigger render={button} />
      <TooltipContent
        side="bottom"
        hideArrow
        className="flex w-[268px] max-w-none flex-col items-stretch gap-0 rounded-xl border border-border bg-card p-3.5 text-foreground shadow-lg"
      >
        <div className="text-[13px] font-bold leading-snug break-words">{project.name}</div>
        {project.alias && (
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground break-words">
            {project.alias}
          </div>
        )}

        <div className="my-2.5 h-px bg-border" />

        {/* running */}
        <div className="mb-2 flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
          <span className="text-[13px] font-semibold">{t("board.running")}</span>
          <span className="text-[11px] text-muted-foreground">{t("board.runningDesc")}</span>
          <span className="ml-auto font-mono text-[15px] font-bold text-amber-500 dark:text-amber-400">{running}</span>
        </div>

        {/* total */}
        <div className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-sky-500 dark:bg-sky-400" />
          <span className="text-[13px] font-semibold">{t("board.overview")}</span>
          <span className="text-[11px] text-muted-foreground">{t("board.totalDesc")}</span>
          <span className="ml-auto font-mono text-[15px] font-bold">{total}</span>
        </div>

        {/* progress: running share of total */}
        <div className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-sky-500/15 dark:bg-sky-400/15">
          <div
            className="h-full rounded-full bg-amber-500 dark:bg-amber-400"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">{t("board.badgeFormatHint")}</span>
          <Button
            variant="outline"
            disabled={isOpeningStudio}
            onClick={openStudio}
            className="h-6 shrink-0 gap-1 px-2 text-[11px]"
          >
            {isOpeningStudio ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FolderOpen className="h-3 w-3" />
            )}
            {t("git.openStudio")}
          </Button>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function ProjectTabs({ projects, activeProjectId, workspaceId, onSelect }: ProjectTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const checkOverflow = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeftArrow(el.scrollLeft > 0);
    setShowRightArrow(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener("scroll", checkOverflow);
      const observer = new ResizeObserver(checkOverflow);
      observer.observe(el);
      return () => {
        el.removeEventListener("scroll", checkOverflow);
        observer.disconnect();
      };
    }
  }, [projects]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -150 : 150, behavior: "smooth" });
  };

  return (
    <div className="relative flex items-center">
      {showLeftArrow && (
        <button
          onClick={() => scroll("left")}
          className="absolute left-0 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-none px-1 py-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {projects.map((p) => (
          <ProjectTab
            key={p.id}
            project={p}
            isActive={activeProjectId === p.id}
            workspaceId={workspaceId}
            onSelect={onSelect}
          />
        ))}
      </div>

      {showRightArrow && (
        <button
          onClick={() => scroll("right")}
          className="absolute right-0 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
