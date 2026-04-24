"use client";

import { useState } from "react";
import {
  ChevronDown, ChevronRight, Archive, ArrowUpFromLine, Trash2, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { gitAction } from "@/lib/git-api";

interface Stash {
  index: number;
  message: string;
}

interface GitStashPanelProps {
  localPath: string;
  stashes: Stash[];
  hasChanges: boolean;
  onRefresh: () => Promise<void>;
}

export function GitStashPanel({ localPath, stashes, hasChanges, onRefresh }: GitStashPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stashMsg, setStashMsg] = useState("");
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      await gitAction(localPath, "stash-save", { message: stashMsg });
      setStashMsg("");
      toast.success(t("git.stashSaved"));
      await onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handlePop = async (index: number) => {
    setLoadingIndex(index);
    try {
      await gitAction(localPath, "stash-pop", { index });
      toast.success(t("git.stashApplied"));
      await onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingIndex(null);
    }
  };

  const handleDrop = async (index: number) => {
    setLoadingIndex(index);
    try {
      await gitAction(localPath, "stash-drop", { index });
      toast.success(t("git.stashDropped"));
      await onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingIndex(null);
    }
  };

  if (!hasChanges && stashes.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between py-1"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("git.stash")} {stashes.length > 0 && `(${stashes.length})`}
        </p>
        {expanded
          ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-2">
          {/* Save stash */}
          {hasChanges && (
            <div className="flex gap-1.5">
              <Input
                value={stashMsg}
                onChange={(e) => setStashMsg(e.target.value)}
                placeholder={t("git.stashMsgPlaceholder")}
                className="h-7 text-xs flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <Button
                variant="outline"
                size="icon-xs"
                onClick={handleSave}
                disabled={saving}
                className="shrink-0"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
              </Button>
            </div>
          )}

          {/* Stash list */}
          {stashes.length > 0 && (
            <div className="space-y-0.5">
              {stashes.map((s) => (
                <div
                  key={s.index}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
                >
                  <Archive className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate text-xs text-foreground">
                    {s.message || `stash@{${s.index}}`}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handlePop(s.index)}
                      disabled={loadingIndex === s.index}
                      className="text-muted-foreground"
                      aria-label={t("git.stashApply")}
                    >
                      {loadingIndex === s.index ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ArrowUpFromLine className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDrop(s.index)}
                      disabled={loadingIndex === s.index}
                      className="text-rose-400"
                      aria-label={t("git.stashDrop")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
