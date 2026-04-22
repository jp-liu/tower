"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsNav } from "@/components/settings/settings-nav";
import { AIToolsConfig } from "@/components/settings/ai-tools-config";
import { GeneralConfig } from "@/components/settings/general-config";
import { PromptsConfig } from "@/components/settings/prompts-config";
import { SystemConfig } from "@/components/settings/system-config";
import { CliProfileConfig } from "@/components/settings/cli-profile-config";

export default function SettingsPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState("general");

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
        <Button
          variant="outline"
          onClick={handleClose}
          className="absolute right-4 top-4 gap-1.5 bg-card shadow-sm"
        >
          <X className="h-3.5 w-3.5" />
          ESC
        </Button>

        <div className="mx-auto max-w-3xl">
          {activeSection === "general" && <GeneralConfig />}

          {activeSection === "ai-tools" && <AIToolsConfig />}

          {activeSection === "prompts" && <PromptsConfig />}

          {activeSection === "config" && <SystemConfig />}

          {activeSection === "cli-profile" && <CliProfileConfig />}
        </div>
      </div>
    </div>
  );
}
