"use client";

import { useState } from "react";
import { Boxes, Plus, Pencil, Trash2, X, Loader2, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubPageNav } from "@/components/layout/sub-page-nav";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import {
  createProductGroup,
  updateProductGroup,
  deleteProductGroup,
  setProjectGroup,
} from "@/actions/group-actions";

interface GroupItem {
  id: string;
  name: string;
  description: string | null;
  projects: { id: string; name: string; alias: string | null }[];
}

interface ProjectItem {
  id: string;
  name: string;
  alias: string | null;
  groupId: string | null;
}

interface GroupsPageClientProps {
  workspaceId: string;
  initialGroups: GroupItem[];
  allProjects: ProjectItem[];
}

const ADD_MEMBER = "__add_member__";

export function GroupsPageClient({ workspaceId, initialGroups, allProjects }: GroupsPageClientProps) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<GroupItem[]>(initialGroups);
  const [projects, setProjects] = useState<ProjectItem[]>(allProjects);

  // create-group inline form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  // per-group edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const memberProjects = (groupId: string) => projects.filter((p) => p.groupId === groupId);
  const addableProjects = (groupId: string) => projects.filter((p) => p.groupId !== groupId);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || savingNew) return;
    setSavingNew(true);
    try {
      const group = await createProductGroup({ name, description: newDesc.trim() || undefined, workspaceId });
      setGroups((prev) => [...prev, { id: group.id, name: group.name, description: group.description, projects: [] }]);
      setCreating(false);
      setNewName("");
      setNewDesc("");
      toast.success(t("group.createdToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("group.createError"));
    } finally {
      setSavingNew(false);
    }
  };

  const startEdit = (g: GroupItem) => {
    setEditingId(g.id);
    setEditName(g.name);
    setEditDesc(g.description ?? "");
  };

  const handleSaveEdit = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    setBusyId(id);
    try {
      await updateProductGroup(id, { name, description: editDesc.trim() || null });
      setGroups((prev) =>
        prev.map((g) => (g.id === id ? { ...g, name, description: editDesc.trim() || null } : g))
      );
      setEditingId(null);
      toast.success(t("group.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("group.createError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (g: GroupItem) => {
    if (!confirm(t("group.deleteConfirm", { name: g.name }))) return;
    setBusyId(g.id);
    try {
      await deleteProductGroup(g.id);
      setGroups((prev) => prev.filter((x) => x.id !== g.id));
      // detach members locally
      setProjects((prev) => prev.map((p) => (p.groupId === g.id ? { ...p, groupId: null } : p)));
      toast.success(t("group.deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("group.createError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleAddMember = async (groupId: string, projectId: string) => {
    setBusyId(groupId);
    try {
      await setProjectGroup(projectId, groupId);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, groupId } : p)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("group.createError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveMember = async (projectId: string) => {
    try {
      await setProjectGroup(projectId, null);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, groupId: null } : p)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("group.createError"));
    }
  };

  const projectLabel = (p: { name: string; alias: string | null }) =>
    p.alias ? `${p.name} (${p.alias})` : p.name;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SubPageNav workspaceId={workspaceId} />

      {/* Action bar */}
      <div className="header-sm flex items-center gap-3 px-6 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{t("group.manageTitle")}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t("group.manageDesc")}
                  className="text-muted-foreground/60 transition-colors hover:text-foreground"
                />
              }
            >
              <Lightbulb className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">{t("group.manageDesc")}</TooltipContent>
          </Tooltip>
        </div>
        <Button
          onClick={() => { setCreating(true); setNewName(""); setNewDesc(""); }}
          className="ml-auto gap-1.5 bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="text-xs">{t("group.create")}</span>
        </Button>
      </div>

      {/* Create dialog — narrow, centered like other dialogs */}
      <Dialog open={creating} onOpenChange={(o) => { if (!o) setCreating(false); }} disablePointerDismissal>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("group.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("group.name")}</label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
                placeholder={t("group.namePlaceholder")}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("group.desc")}</label>
              <Textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                placeholder={t("group.descPlaceholder")}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || savingNew}
              className="bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
            >
              {savingNew ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Boxes className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">{t("group.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const members = memberProjects(g.id);
              const addable = addableProjects(g.id);
              const isEditing = editingId === g.id;
              const isBusy = busyId === g.id;
              return (
                <div key={g.id} className={`rounded-xl border bg-card p-4 ${isBusy ? "opacity-60" : ""}`}>
                  {isEditing ? (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">{t("group.name")}</label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1.5" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">{t("group.desc")}</label>
                        <Textarea
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          rows={2}
                          placeholder={t("group.descPlaceholder")}
                          className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring resize-none"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setEditingId(null)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => handleSaveEdit(g.id)}
                          disabled={!editName.trim() || isBusy}
                          className="bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
                        >
                          {t("group.save")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{g.name}</div>
                          {g.description && (
                            <div className="mt-0.5 text-xs text-muted-foreground">{g.description}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => startEdit(g)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-rose-400" onClick={() => handleDelete(g)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Members */}
                      <div className="mt-3">
                        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          {t("group.members")}
                        </div>
                        {members.length === 0 ? (
                          <p className="text-xs text-muted-foreground/70">{t("group.noMembers")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {members.map((p) => (
                              <span
                                key={p.id}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 py-0.5 pl-2 pr-1 text-xs text-foreground"
                              >
                                {projectLabel(p)}
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="text-muted-foreground hover:text-rose-400"
                                  title={t("group.removeMember")}
                                  onClick={() => handleRemoveMember(p.id)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Add member */}
                        {addable.length > 0 && (
                          <div className="mt-2">
                            <Select value={ADD_MEMBER} onValueChange={(v) => { if (v && v !== ADD_MEMBER) handleAddMember(g.id, v); }}>
                              <SelectTrigger className="h-8 w-auto min-w-[160px]">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                  <Plus className="h-3.5 w-3.5" />
                                  {t("group.addMember")}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                {addable.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{projectLabel(p)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
