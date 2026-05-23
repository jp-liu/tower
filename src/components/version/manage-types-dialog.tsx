"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getVersionTypes,
  createVersionType,
  updateVersionType,
  deleteVersionType,
} from "@/actions/version-type-actions";
import { typeBadgeColor } from "@/components/version/version-badges";
import { useI18n } from "@/lib/i18n";

interface VersionType {
  id: string;
  name: string;
}

export interface ManageTypesDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: string;
  onChanged?: () => void;
}

export function ManageTypesDialog({
  open,
  onOpenChange,
  workspaceId,
  onChanged,
}: ManageTypesDialogProps) {
  const { t } = useI18n();
  const [types, setTypes] = useState<VersionType[]>([]);
  const [newName, setNewName] = useState("");
  const [editNames, setEditNames] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const reload = async () => {
    const data = await getVersionTypes(workspaceId);
    setTypes(data);
    // sync edit names map
    setEditNames((prev) => {
      const next: Record<string, string> = {};
      data.forEach((t) => {
        next[t.id] = t.id in prev ? prev[t.id] : t.name;
      });
      return next;
    });
  };

  useEffect(() => {
    if (open) {
      reload();
      setNewName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await createVersionType({ workspaceId, name: trimmed });
        setNewName("");
        await reload();
        onChanged?.();
        toast.success(t("version.type.add"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const handleSave = (id: string) => {
    const name = (editNames[id] ?? "").trim();
    if (!name) return;
    const current = types.find((t) => t.id === id);
    if (current?.name === name) return;
    startTransition(async () => {
      try {
        await updateVersionType(id, { name });
        await reload();
        onChanged?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        // revert
        setEditNames((prev) => ({ ...prev, [id]: current?.name ?? "" }));
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm(t("version.type.deleteConfirm"))) return;
    startTransition(async () => {
      try {
        await deleteVersionType(id);
        await reload();
        onChanged?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("version.manageTypes")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Add row */}
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("version.type.namePlaceholder")}
              disabled={isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              className="flex-1"
            />
            <Button
              onClick={handleAdd}
              disabled={isPending || !newName.trim()}
            >
              {t("version.type.add")}
            </Button>
          </div>

          {/* Type list */}
          {types.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">
              {t("version.type.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {types.map((vt) => (
                <div
                  key={vt.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                >
                  {/* Color dot */}
                  <span
                    className={`inline-flex h-2.5 w-2.5 flex-none rounded-full ${typeBadgeColor(editNames[vt.id] ?? vt.name).split(" ").filter((c) => c.startsWith("bg-"))[0] ?? "bg-muted"}`}
                  />
                  {/* Inline editable name */}
                  <Input
                    value={editNames[vt.id] ?? vt.name}
                    onChange={(e) =>
                      setEditNames((prev) => ({
                        ...prev,
                        [vt.id]: e.target.value,
                      }))
                    }
                    onBlur={() => handleSave(vt.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    disabled={isPending}
                    className="h-7 flex-1 border-transparent bg-transparent shadow-none focus-visible:border-input focus-visible:bg-background focus-visible:shadow-sm"
                  />
                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-none text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(vt.id)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
