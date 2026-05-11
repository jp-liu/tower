"use client";

import { X, GitCompare, History } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface EditorTab {
  path: string;
  relativePath: string;
  filename: string;
  content: string;
  isDirty: boolean;
  isDiff?: boolean;
  originalContent?: string;
  // commit-diff tab fields (v1.3.1):
  isCommitDiff?: boolean;
  commitHash?: string;
  patch?: string;
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
    <div className="flex items-stretch overflow-x-auto bg-card flex-1 min-w-0">
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
            {tab.isDiff && !tab.isCommitDiff && (
              <GitCompare className="w-3 h-3 text-amber-400 shrink-0" />
            )}
            {tab.isCommitDiff && (
              <History className="w-3 h-3 text-sky-400 shrink-0" />
            )}
            {tab.isDirty && (
              <span className="text-primary text-xs">●</span>
            )}
            <span>{tab.filename}</span>
            {tab.isDiff && !tab.isCommitDiff && (
              <span className="text-muted-foreground text-xs ml-0.5">
                {t("editor.diffTabSuffix")}
              </span>
            )}
            {tab.isCommitDiff && tab.commitHash && (
              <span className="text-muted-foreground text-xs ml-0.5 font-mono">
                · {tab.commitHash.slice(0, 7)}
              </span>
            )}
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
