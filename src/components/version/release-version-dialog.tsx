"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { releaseVersion } from "@/actions/version-actions";
import { useI18n } from "@/lib/i18n";

export interface ReleaseVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: {
    id: string;
    number: string;
    name: string;
    unfinishedCount?: number;
  } | null;
  candidates: { id: string; number: string; name: string }[];
  onSuccess?: () => void;
}

export function ReleaseVersionDialog(props: ReleaseVersionDialogProps) {
  const formKey = `${props.open ? "open" : "closed"}:${props.version?.id ?? "none"}`;
  return <ReleaseVersionDialogState key={formKey} {...props} />;
}

function ReleaseVersionDialogState({
  open,
  onOpenChange,
  version,
  candidates,
  onSuccess,
}: ReleaseVersionDialogProps) {
  const { t } = useI18n();
  const [selectedNextId, setSelectedNextId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const selectedCandidate = candidates.find((c) => c.id === selectedNextId);
  const hasCandidates = candidates.length > 0;
  const canConfirm = hasCandidates && !!selectedNextId && !isPending;

  const handleConfirm = () => {
    if (!version || !selectedNextId) return;

    startTransition(async () => {
      try {
        await releaseVersion(version.id, selectedNextId);
        toast.success(t("version.release"));
        onOpenChange(false);
        onSuccess?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("version.releaseAction")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Version being released */}
          {version && (
            <p className="text-sm text-muted-foreground">
              {version.number} · {version.name}
            </p>
          )}

          {/* Rollover hint */}
          <div className="text-sm">
            <span>{t("version.release.rolloverHint")}</span>
            {version?.unfinishedCount !== undefined &&
              version.unfinishedCount > 0 && (
                <span className="ml-1 font-medium text-foreground">
                  ({version.unfinishedCount})
                </span>
              )}
          </div>

          {/* Next current version selector */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">
              {t("version.release.nextVersion")}
            </label>
            {hasCandidates ? (
              <Select
                value={selectedNextId}
                onValueChange={(v) => {
                  if (v) setSelectedNextId(v);
                }}
                disabled={isPending}
              >
                <SelectTrigger className="w-full">
                  <span className="truncate">
                    {selectedCandidate
                      ? `${selectedCandidate.number} · ${selectedCandidate.name}`
                      : ""}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.number} · {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-destructive">
                {t("version.release.noCandidates")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {t("version.release")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
