"use client";

import { Settings, Cpu, FileText, SlidersHorizontal } from "lucide-react";

const NAV_ITEMS = [
  {
    id: "general",
    label: "General",
    description: "Appearance and language preferences",
    icon: Settings,
  },
  {
    id: "ai-tools",
    label: "AI Tools",
    description: "AI tool configuration",
    icon: Cpu,
  },
  {
    id: "prompts",
    label: "Prompts",
    description: "AI prompt templates",
    icon: FileText,
  },
  {
    id: "config",
    label: "Config",
    description: "System configuration parameters",
    icon: SlidersHorizontal,
  },
];

interface SettingsNavProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

export function SettingsNav({ activeSection, onSectionChange }: SettingsNavProps) {
  return (
    <nav className="w-64 flex-shrink-0 border-r bg-card p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">配置</h1>
        <p className="text-sm text-muted-foreground">配置说明</p>
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
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground/70">{item.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
