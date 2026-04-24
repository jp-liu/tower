"use client";

import { useState, useEffect } from "react";
import { GitBranch, ChevronDown, Search, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";

export interface CreateBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: string[];
  currentBranch: string;
  localPath: string;
  onCreated: () => void;
  onError: (msg: string) => void;
}

export function CreateBranchDialog({
  open, onOpenChange, branches, currentBranch, localPath, onCreated, onError,
}: CreateBranchDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState(currentBranch);
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [baseFilter, setBaseFilter] = useState("");
  const [showBaseList, setShowBaseList] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setBaseBranch(currentBranch);
      setDesc("");
      setBaseFilter("");
    }
  }, [open, currentBranch]);

  const uniqueBranches = [...new Set(branches)];
  const filteredBases = uniqueBranches.filter((b) =>
    b.toLowerCase().includes(baseFilter.toLowerCase())
  );

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-branch",
          path: localPath,
          branch: name.trim(),
          baseBranch,
        }),
      });
      if (res.ok) {
        onOpenChange(false);
        onCreated();
      } else {
        const err = await res.json();
        onError(err.error || "Unknown error");
      }
    } catch {
      onError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("git.createBranch")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("git.branchName")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("git.branchNamePlaceholder")}
              className="mt-1.5 font-mono text-xs"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("git.baseBranch")}</label>
            <div className="relative mt-1.5">
              <button
                onClick={() => setShowBaseList(!showBaseList)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3 w-3 text-emerald-400" />
                  <span className="font-mono text-xs text-foreground">{baseBranch}</span>
                </div>
                <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${showBaseList ? "rotate-180" : ""}`} />
              </button>

              {showBaseList && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-border bg-popover shadow-xl">
                  <div className="border-b border-border p-1.5">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <input
                        value={baseFilter}
                        onChange={(e) => setBaseFilter(e.target.value)}
                        placeholder="Filter..."
                        autoFocus
                        className="h-7 w-full rounded-md bg-muted/50 pl-7 pr-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <div className="max-h-40 overflow-auto py-1">
                    {filteredBases.map((b) => (
                      <button
                        key={b}
                        onClick={() => { setBaseBranch(b); setShowBaseList(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                          b === baseBranch ? "bg-emerald-500/10 text-emerald-400" : "text-secondary-foreground hover:bg-accent"
                        }`}
                      >
                        <GitBranch className="h-3 w-3 shrink-0" />
                        <span className="truncate font-mono text-xs">{b}</span>
                        {b === baseBranch && <Check className="h-3 w-3 ml-auto shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("git.branchDesc")}</label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t("git.branchDescPlaceholder")}
              rows={2}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
