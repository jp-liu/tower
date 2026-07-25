"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { useAssistant } from "./assistant-provider";
import { getVersionsForPicker } from "@/actions/version-actions";

// Sentinel for the "no selection" option — Base UI Select can't take "" as an
// item value, so we map this token to an empty binding field.
const NONE = "__none__";

type VersionOption = { id: string; number: string; name: string | null };

/**
 * Workspace + project + version scope pickers for the active chat session.
 * Cascading: project list is scoped to the chosen workspace; version list is
 * scoped to the chosen project (excludes RELEASED, same as list_versions). All
 * optional — the binding is a soft default, not a hard filter (global requests
 * ignore it). A picked version is fed into create_task as the default versionId.
 */
export function AssistantBindingBar() {
  const { binding, setSessionBinding, workspaceTree } = useAssistant();
  const { t } = useI18n();

  const workspace = workspaceTree.find((w) => w.id === binding.workspaceId);
  const projects = workspace?.projects ?? [];

  // Versions for the bound project. Refetched whenever the project changes.
  const [versionResult, setVersionResult] = useState<{
    projectId: string;
    versions: VersionOption[];
  } | null>(null);
  const versions =
    versionResult && versionResult.projectId === binding.projectId ? versionResult.versions : [];
  useEffect(() => {
    if (!binding.projectId) return;
    const projectId = binding.projectId;
    let cancelled = false;
    getVersionsForPicker(projectId)
      .then((nextVersions) => {
        if (!cancelled) setVersionResult({ projectId, versions: nextVersions });
      })
      .catch(() => {
        if (!cancelled) setVersionResult({ projectId, versions: [] });
      });
    return () => { cancelled = true; };
  }, [binding.projectId]);

  const onWorkspaceChange = (v: string | null) => {
    if (!v || v === NONE) {
      // Clearing the workspace also clears the project + version.
      setSessionBinding({});
      return;
    }
    const ws = workspaceTree.find((w) => w.id === v);
    if (!ws) return;
    setSessionBinding({ workspaceId: ws.id, workspaceName: ws.name });
  };

  const onProjectChange = (v: string | null) => {
    // Switching/clearing the project always drops the version binding.
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

  const onVersionChange = (v: string | null) => {
    if (!v || v === NONE) {
      setSessionBinding({
        workspaceId: binding.workspaceId,
        workspaceName: binding.workspaceName,
        projectId: binding.projectId,
        projectName: binding.projectName,
      });
      return;
    }
    const ver = versions.find((x) => x.id === v);
    if (!ver) return;
    const label = ver.name ? `${ver.number} ${ver.name}` : ver.number;
    setSessionBinding({
      workspaceId: binding.workspaceId,
      workspaceName: binding.workspaceName,
      projectId: binding.projectId,
      projectName: binding.projectName,
      versionId: ver.id,
      versionName: label,
    });
  };

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border bg-sidebar">
      <Select value={binding.workspaceId || NONE} onValueChange={onWorkspaceChange}>
        <SelectTrigger
          className="h-7 flex-1 min-w-0 text-xs"
          aria-label={t("assistant.binding.workspaceLabel")}
        >
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
        <SelectTrigger
          className="h-7 flex-1 min-w-0 text-xs"
          disabled={!binding.workspaceId}
          aria-label={t("assistant.binding.projectLabel")}
        >
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

      <Select
        value={binding.versionId || NONE}
        onValueChange={onVersionChange}
        disabled={!binding.projectId}
      >
        <SelectTrigger
          className="h-7 flex-1 min-w-0 text-xs"
          disabled={!binding.projectId}
          aria-label={t("assistant.binding.versionLabel")}
        >
          <span className="truncate">
            {binding.versionName ??
              (binding.projectId
                ? t("assistant.binding.allVersions")
                : t("assistant.binding.pickProjectFirst"))}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("assistant.binding.allVersions")}</SelectItem>
          {versions.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name ? `${v.number} ${v.name}` : v.number}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
