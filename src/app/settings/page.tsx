"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { SettingsNav } from "@/components/settings/settings-nav";
import { AIToolsConfig } from "@/components/settings/ai-tools-config";
import { CLIAdapterTester } from "@/components/settings/cli-adapter-tester";
import { GeneralConfig } from "@/components/settings/general-config";
import { PromptsConfig } from "@/components/settings/prompts-config";
import type { Prisma } from "@prisma/client";
import {
  getAgentConfigs,
  updateAgentConfig,
  deleteAgentConfig,
} from "@/actions/agent-config-actions";

interface AgentConfig {
  id: string;
  agent: string;
  configName: string;
  appendPrompt: string | null;
  settings: Record<string, unknown> | null;
  isDefault: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState("general");
  const [configs, setConfigs] = useState<AgentConfig[]>([]);

  useEffect(() => {
    getAgentConfigs().then((data) => {
      setConfigs(
        data.map((c) => ({
          ...c,
          settings: c.settings as Record<string, unknown> | null,
        }))
      );
    });
  }, []);

  const handleSave = useCallback(
    async (data: { agent: string; configName: string; isDefault: boolean }) => {
      const existing = configs.find(
        (c) => c.agent === data.agent && c.configName === data.configName
      );
      if (existing) {
        await updateAgentConfig(existing.id, { isDefault: data.isDefault });
        const updated = await getAgentConfigs();
        setConfigs(
          updated.map((c) => ({
            ...c,
            settings: c.settings as Record<string, unknown> | null,
          }))
        );
        router.refresh();
      }
    },
    [configs, router]
  );

  const handleUpdateConfig = useCallback(
    async (
      id: string,
      data: { appendPrompt?: string; settings?: Record<string, unknown> }
    ) => {
      await updateAgentConfig(id, {
        appendPrompt: data.appendPrompt,
        settings: data.settings as Prisma.InputJsonValue | undefined,
      });
      const updated = await getAgentConfigs();
      setConfigs(
        updated.map((c) => ({
          ...c,
          settings: c.settings as Record<string, unknown> | null,
        }))
      );
      router.refresh();
    },
    [router]
  );

  const handleDeleteConfig = useCallback(async (id: string) => {
    await deleteAgentConfig(id);
    setConfigs((prev) => prev.filter((c) => c.id !== id));
    router.refresh();
  }, [router]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <div className="flex h-full bg-background">
      <SettingsNav
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />

      <div className="relative flex-1 overflow-auto p-8">
        {/* ESC close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-sm hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
          ESC
        </button>

        <div className="mx-auto max-w-3xl">
          {activeSection === "general" && <GeneralConfig />}

          {activeSection === "ai-tools" && (
            <div className="space-y-8">
              <AIToolsConfig
                configs={configs}
                onSave={handleSave}
                onUpdateConfig={handleUpdateConfig}
                onDeleteConfig={handleDeleteConfig}
              />
              <CLIAdapterTester
                adapterType="claude_local"
                adapterLabel="Claude Code"
              />
            </div>
          )}

          {activeSection === "prompts" && <PromptsConfig />}
        </div>
      </div>
    </div>
  );
}
