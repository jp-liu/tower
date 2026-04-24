"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, FileText, FolderOpen, Archive } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface SubPageNavProps {
  workspaceId: string;
}

const tabs = [
  { key: "notes", icon: FileText },
  { key: "assets", icon: FolderOpen },
  { key: "archive", icon: Archive },
] as const;

export function SubPageNav({ workspaceId }: SubPageNavProps) {
  const { t } = useI18n();
  const pathname = usePathname();

  const currentTab = tabs.find((tab) => pathname.includes(`/${tab.key}`))?.key;

  return (
    <div className="header-sm flex items-center gap-1 px-4 py-2">
      <Link
        href={`/workspaces/${workspaceId}`}
        className="mr-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>{t("archive.backToBoard")}</span>
      </Link>
      <span className="mr-2 h-4 w-px bg-border" />
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = currentTab === tab.key;
        return (
          <Link
            key={tab.key}
            href={`/workspaces/${workspaceId}/${tab.key}`}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{t(`sidebar.${tab.key}` as "sidebar.notes" | "sidebar.assets" | "sidebar.archive")}</span>
          </Link>
        );
      })}
    </div>
  );
}
