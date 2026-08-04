"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  disableUnattendedGoalFromUi,
  enableUnattendedGoalFromUi,
  getUnattendedGoalControl,
} from "@/actions/unattended-goal-actions";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

type ControlState = Awaited<ReturnType<typeof getUnattendedGoalControl>>;

export function UnattendedGoalControl({ taskId }: { taskId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ControlState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState("480");
  const [maxUses, setMaxUses] = useState("20");
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mutationInFlight = useRef(false);

  const loadControl = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setState(await getUnattendedGoalControl(taskId));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    getUnattendedGoalControl(taskId)
      .then((value) => { if (!cancelled) setState(value); })
      .catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  const active = Boolean(state?.active && state.ownerMessageGrant);
  const apply = () => {
    // useTransition updates `pending` on the next render. Guard synchronously too,
    // so two clicks in the same event turn cannot submit the mutation twice.
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setUpdateError(null);
    startTransition(async () => {
      try {
        if (active) {
          await disableUnattendedGoalFromUi(taskId);
        } else {
          await enableUnattendedGoalFromUi({
            taskId,
            durationMinutes: Number(durationMinutes),
            maxUses: Number(maxUses),
            capabilities: [...selectedCapabilities],
          });
        }
        setState(await getUnattendedGoalControl(taskId));
        setLoadFailed(false);
        setDialogOpen(false);
        toast.success(active ? t("unattended.disabled") : t("unattended.enabled"));
      } catch (error) {
        const message = error instanceof Error ? error.message : t("unattended.updateFailed");
        setUpdateError(message);
        toast.error(message);
      } finally {
        mutationInFlight.current = false;
      }
    });
  };

  const remaining = state?.ownerMessageGrant?.remainingUses ?? 0;
  const optionalCapabilities = state?.capabilities.filter((item) =>
    item.lane === "JOB" && (item.risk === "R2" || item.risk === "R3")
  ) ?? [];
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={active
                ? "gap-1.5 text-emerald-500 hover:text-emerald-500"
                : "gap-1.5 text-muted-foreground"}
              onClick={() => loadFailed ? void loadControl() : setDialogOpen(true)}
              disabled={pending || loading}
            />
          }
        >
          {pending || loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : active
            ? <ShieldCheck className="h-3.5 w-3.5" />
            : <ShieldOff className="h-3.5 w-3.5" />}
          {t(loading
            ? "unattended.loading"
            : loadFailed
              ? "unattended.retry"
              : active
                ? "unattended.active"
                : "unattended.inactive")}
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {loadFailed
            ? t("unattended.updateFailed")
            : active
              ? t("unattended.remaining", { count: String(remaining) })
              : t("unattended.enableHint")}
        </TooltipContent>
      </Tooltip>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (pending) return;
          setDialogOpen(open);
          if (!open) setUpdateError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(active ? "unattended.disableTitle" : "unattended.enableTitle")}</DialogTitle>
            <DialogDescription>
              {t(active ? "unattended.disableDescription" : "unattended.enableDescription")}
            </DialogDescription>
          </DialogHeader>
          {!active && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-xs text-muted-foreground">
                  {t("unattended.duration")}
                  <Select value={durationMinutes} onValueChange={(value) => value && setDurationMinutes(value)}>
                    <SelectTrigger className="w-full">
                      <span>{t(`unattended.duration.${durationMinutes}` as Parameters<typeof t>[0])}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="120">{t("unattended.duration.120")}</SelectItem>
                      <SelectItem value="480">{t("unattended.duration.480")}</SelectItem>
                      <SelectItem value="1440">{t("unattended.duration.1440")}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1.5 text-xs text-muted-foreground">
                  {t("unattended.actionLimit")}
                  <Select value={maxUses} onValueChange={(value) => value && setMaxUses(value)}>
                    <SelectTrigger className="w-full"><span>{maxUses}</span></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              {optionalCapabilities.length > 0 && (
                <div className="grid gap-2">
                  <div className="text-xs font-medium">{t("unattended.externalCapabilities")}</div>
                  {optionalCapabilities.map((capability) => (
                    <label key={capability.capability} className="flex items-start gap-2 text-xs">
                      <Checkbox
                        className="mt-0.5"
                        checked={selectedCapabilities.has(capability.capability)}
                        disabled={!capability.available}
                        onCheckedChange={(checked) => setSelectedCapabilities((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(capability.capability);
                          else next.delete(capability.capability);
                          return next;
                        })}
                      />
                      <span className="grid gap-0.5">
                        <span className="font-medium text-foreground">{capability.capability} · {capability.risk}</span>
                        <span className="text-muted-foreground">{capability.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {updateError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {updateError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={active ? "destructive" : "default"}
              onClick={apply}
              disabled={pending}
              aria-busy={pending}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t(active ? "unattended.disableAction" : "unattended.enableAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
