"use client";

import { Settings, Cpu, FileText, SlidersHorizontal } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const NAV_ITEMS = [
  {
    id: "general",
    labelKey: "settings.general" as const,
    descKey: "settings.generalDesc" as const,
    icon: Settings,
  },
  {
    id: "ai-tools",
    labelKey: "settings.aiTools.title" as const,
    descKey: "settings.aiTools.cliVerificationDesc" as const,
    icon: Cpu,
  },
  {
    id: "prompts",
    labelKey: "settings.prompts" as const,
    descKey: "settings.promptsDesc" as const,
    icon: FileText,
  },
  {
    id: "config",
    labelKey: "settings.config" as const,
    descKey: "settings.configDesc" as const,
    icon: SlidersHorizontal,
  },
];

interface SettingsNavProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

export function SettingsNav({ activeSection, onSectionChange }: SettingsNavProps) {
  const { t } = useI18n();
  return (
    <nav className="w-64 flex-shrink-0 border-r bg-card p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.configDesc")}</p>
      </div>

      <div className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icon className={`mt-0.5 h-4 w-4 ${isActive ? "text-accent-foreground" : "text-muted-foreground"}`} />
              <div>
                <div className="text-sm font-medium">{t(item.labelKey)}</div>
                <div className="text-xs text-muted-foreground/70">{t(item.descKey)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
