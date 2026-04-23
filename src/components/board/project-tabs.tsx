"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ProjectTabsProps {
  projects: Array<{ id: string; name: string; alias: string | null }>;
  activeProjectId: string;
  onSelect: (projectId: string) => void;
}

export function ProjectTabs({ projects, activeProjectId, onSelect }: ProjectTabsProps) {
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
        {projects.map((p) => {
          const isActive = activeProjectId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => { if (!isActive) onSelect(p.id); }}
              className={`shrink-0 rounded-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20 cursor-default"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              }`}
            >
              <span>{p.name}</span>
              {p.alias && (
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                  {p.alias}
                </span>
              )}
            </button>
          );
        })}
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
