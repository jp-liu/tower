"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { getWorkspacesWithProjects } from "@/actions/workspace-actions";
import { getProjectTasks } from "@/actions/task-actions";
import { startPtyExecution } from "@/actions/agent-actions";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface WorkspaceWithProjects {
  id: string;
  name: string;
  projects: Array<{ id: string; name: string; alias: string | null }>;
}

interface TaskItem {
  id: string;
  title: string;
  status: string;
}

interface TaskPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunched: (taskId: string) => void;
}

export function TaskPickerDialog({
  open,
  onOpenChange,
  onLaunched,
}: TaskPickerDialogProps) {
  const { t } = useI18n();

  const [workspaces, setWorkspaces] = useState<WorkspaceWithProjects[]>([]);
  const [selectedWsId, setSelectedWsId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [isLaunching, setIsLaunching] = useState(false);

  // Load workspaces when dialog opens; reset selections
  useEffect(() => {
    if (!open) return;
    setSelectedWsId("");
    setSelectedProjectId("");
    setSelectedTaskId("");
    setTasks([]);
    getWorkspacesWithProjects().then(setWorkspaces).catch(() => {});
  }, [open]);

  // Load tasks when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setTasks([]);
      setSelectedTaskId("");
      return;
    }
    getProjectTasks(selectedProjectId)
      .then((all) => {
        const filtered = all.filter(
          (tk) => tk.status === "TODO" || tk.status === "IN_PROGRESS"
        );
        setTasks(filtered);
        setSelectedTaskId("");
      })
      .catch(() => {});
  }, [selectedProjectId]);

  const selectedWs = workspaces.find((w) => w.id === selectedWsId);
  const projects = selectedWs?.projects ?? [];

  const handleLaunch = async () => {
    if (!selectedTaskId) return;
    try {
      setIsLaunching(true);
      await startPtyExecution(selectedTaskId, "");
      onLaunched(selectedTaskId);
      onOpenChange(false);
    } catch {
      toast.error(t("missions.error.launchFailed"));
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("missions.launcher.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Workspace select */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {t("missions.launcher.workspace")}
            </label>
            <Select value={selectedWsId} onValueChange={(v) => { setSelectedWsId(v ?? ""); setSelectedProjectId(""); }}>
              <SelectTrigger className="w-full h-8">
                <span className="truncate">
                  {workspaces.find((w) => w.id === selectedWsId)?.name ??
                    t("missions.launcher.selectWorkspace")}
                </span>
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Project select */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {t("missions.launcher.project")}
            </label>
            <Select
              value={selectedProjectId}
              onValueChange={(v) => setSelectedProjectId(v ?? "")}
              disabled={!selectedWsId}
            >
              <SelectTrigger className="w-full h-8">
                <span className="truncate">
                  {projects.find((p) => p.id === selectedProjectId)?.name ??
                    t("missions.launcher.selectProject")}
                </span>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.alias ?? p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Task select */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {t("missions.launcher.task")}
            </label>
            <Select
              value={selectedTaskId}
              onValueChange={(v) => setSelectedTaskId(v ?? "")}
              disabled={!selectedProjectId}
            >
              <SelectTrigger className="w-full h-8">
                <span className="truncate">
                  {tasks.find((tk) => tk.id === selectedTaskId)?.title ??
                    t("missions.launcher.selectTask")}
                </span>
              </SelectTrigger>
              <SelectContent>
                {tasks.length === 0 && selectedProjectId ? (
                  <p className="text-sm text-muted-foreground p-2">
                    {t("missions.launcher.noTasks")}
                  </p>
                ) : (
                  tasks.map((tk) => (
                    <SelectItem key={tk.id} value={tk.id}>
                      {tk.title}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("missions.launcher.cancel")}
          </Button>
          <Button
            onClick={handleLaunch}
            disabled={!selectedTaskId || isLaunching}
          >
            {t("missions.launcher.launch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
