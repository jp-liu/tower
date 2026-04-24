"use client";

import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface EditorTab {
  path: string;
  relativePath: string;
  filename: string;
  content: string;
  isDirty: boolean;
  isDiff?: boolean;
  originalContent?: string;
}

export interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabPath: string | null;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
}

export function EditorTabs({ tabs, activeTabPath, onTabClick, onTabClose }: EditorTabsProps) {
  const { t } = useI18n();

  if (tabs.length === 0) return null;

  return (
    <div className="header-xs flex items-stretch overflow-x-auto bg-card flex-shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.path === activeTabPath;
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabClick(tab.path)}
            className={[
              "flex items-center gap-1.5 px-3 text-sm whitespace-nowrap cursor-pointer select-none border-b-2",
              isActive
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.isDiff && (
              <span className="text-amber-400 text-[10px] font-mono font-bold">M</span>
            )}
            {tab.isDirty && (
              <span className="text-primary text-xs">●</span>
            )}
            <span>{tab.filename}</span>
            <button
              type="button"
              aria-label={t("editor.closeTab")}
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.path);
              }}
              className="text-muted-foreground hover:text-foreground ml-0.5 flex items-center"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
