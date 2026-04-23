"use client";

import { useState } from "react";
import { Layers, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { createWorkspace } from "@/actions/workspace-actions";

export default function WorkspacesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleCreateWorkspace() {
    setCreating(true);
    try {
      const ws = await createWorkspace({ name: t("onboarding.defaultWorkspaceName") });
      router.push(`/workspaces/${ws.id}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20">
          <Layers className="h-7 w-7 text-amber-400/60" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{t("workspace.selectHint")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("workspace.selectDesc")}</p>
        <Button className="mt-4" onClick={handleCreateWorkspace} disabled={creating}>
          <Plus className="h-4 w-4 mr-1" />
          {t("onboarding.createWorkspace")}
        </Button>
      </div>
    </div>
  );
}
