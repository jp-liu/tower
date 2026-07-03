"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { useAssistant } from "./assistant-provider";

// Sentinel for the "no selection" option — Base UI Select can't take "" as an
// item value, so we map this token to an empty binding field.
const NONE = "__none__";

/**
 * Workspace + project scope pickers for the active chat session. Cascading:
 * the project list is scoped to the chosen workspace. Both are optional — the
 * binding is a soft default, not a hard filter (global requests ignore it).
 */
export function AssistantBindingBar() {
  const { binding, setSessionBinding, workspaceTree } = useAssistant();
  const { t } = useI18n();

  const workspace = workspaceTree.find((w) => w.id === binding.workspaceId);
  const projects = workspace?.projects ?? [];

  const onWorkspaceChange = (v: string | null) => {
    if (!v || v === NONE) {
      // Clearing the workspace also clears the project (it belonged to it).
      setSessionBinding({});
      return;
    }
    const ws = workspaceTree.find((w) => w.id === v);
    if (!ws) return;
    setSessionBinding({ workspaceId: ws.id, workspaceName: ws.name });
  };

  const onProjectChange = (v: string | null) => {
    if (!v || v === NONE) {
      setSessionBinding({
        workspaceId: binding.workspaceId,
        workspaceName: binding.workspaceName,
      });
      return;
    }
    const proj = projects.find((p) => p.id === v);
    if (!proj) return;
    setSessionBinding({
      workspaceId: binding.workspaceId,
      workspaceName: binding.workspaceName,
      projectId: proj.id,
      projectName: proj.name,
    });
  };

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-sidebar">
      <Select value={binding.workspaceId || NONE} onValueChange={onWorkspaceChange}>
        <SelectTrigger className="h-7 flex-1 min-w-0 text-xs">
          <span className="truncate">
            {binding.workspaceName ?? binding.workspaceId ?? t("assistant.binding.allWorkspaces")}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("assistant.binding.allWorkspaces")}</SelectItem>
          {workspaceTree.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={binding.projectId || NONE}
        onValueChange={onProjectChange}
        disabled={!binding.workspaceId}
      >
        <SelectTrigger className="h-7 flex-1 min-w-0 text-xs" disabled={!binding.workspaceId}>
          <span className="truncate">
            {binding.projectName ??
              (binding.workspaceId
                ? t("assistant.binding.allProjects")
                : t("assistant.binding.pickWorkspaceFirst"))}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("assistant.binding.allProjects")}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
