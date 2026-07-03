"use client";

import { useState, useEffect } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { getProductGroups, createProductGroup } from "@/actions/group-actions";

// Base UI Select can't use "" as an item value; map 无分组 to a sentinel.
const NONE = "__none__";
const NEW_GROUP = "__new_group__";

interface GroupOption {
  id: string;
  name: string;
}

interface GroupSelectProps {
  /** Workspace whose product groups are listed; empty → the select is disabled. */
  workspaceId: string;
  /** Selected groupId, "" means 无分组. */
  value: string;
  onChange: (groupId: string) => void;
}

/**
 * 产品组下拉：无分组 / 现有组 / + 新建组。级联 workspaceId 拉组列表；
 * 选「新建组」切到内联输入，建完自动选中。用于建/导项目弹窗与项目编辑弹窗。
 */
export function GroupSelect({ workspaceId, value, onChange }: GroupSelectProps) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspaceId) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getProductGroups(workspaceId)
      .then((gs) => {
        if (!cancelled) setGroups(gs.map((g) => ({ id: g.id, name: g.name })));
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleSelect = (v: string | null) => {
    if (v === NEW_GROUP) {
      setCreating(true);
      setNewName("");
      return;
    }
    onChange(!v || v === NONE ? "" : v);
  };

  const handleCreateGroup = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const group = await createProductGroup({ name, workspaceId });
      setGroups((prev) => [...prev, { id: group.id, name: group.name }]);
      onChange(group.id);
      setCreating(false);
      setNewName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("group.createError"));
    } finally {
      setSaving(false);
    }
  };

  if (creating) {
    return (
      <div className="mt-1.5 flex gap-2">
        <Input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreateGroup();
            }
          }}
          placeholder={t("group.namePlaceholder")}
          className="flex-1 min-w-0"
        />
        <Button
          type="button"
          onClick={handleCreateGroup}
          disabled={!newName.trim() || saving}
          className="shrink-0 px-2.5"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setCreating(false);
            setNewName("");
          }}
          className="shrink-0 px-2.5"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const selected = groups.find((g) => g.id === value);

  return (
    <Select value={value || NONE} onValueChange={handleSelect} disabled={!workspaceId || loading}>
      <SelectTrigger className="mt-1.5 w-full">
        <span className="truncate">{selected?.name ?? t("group.none")}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("group.none")}</SelectItem>
        {groups.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name}
          </SelectItem>
        ))}
        <SelectItem value={NEW_GROUP}>+ {t("group.new")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
