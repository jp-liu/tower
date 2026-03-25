"use client";

import { Cpu, Sparkles, Plug } from "lucide-react";

const NAV_ITEMS = [
  {
    id: "ai-tools",
    label: "AI Tools",
    description: "AI 工具配置与默认模型",
    icon: Cpu,
  },
  {
    id: "skills",
    label: "Skills",
    description: "Skills 导入、启停与市场安装",
    icon: Sparkles,
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Plugins 入口与 MCP 配置能力",
    icon: Plug,
  },
];

interface SettingsNavProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

export function SettingsNav({ activeSection, onSectionChange }: SettingsNavProps) {
  return (
    <nav className="w-64 flex-shrink-0 border-r bg-white p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">配置</h1>
        <p className="text-sm text-gray-500">配置说明</p>
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
                  ? "bg-purple-50 text-purple-700"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon className={`mt-0.5 h-4 w-4 ${isActive ? "text-purple-600" : "text-gray-400"}`} />
              <div>
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-xs text-gray-400">{item.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
