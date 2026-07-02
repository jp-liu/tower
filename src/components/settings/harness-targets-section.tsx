"use client";

import { useState, useEffect, useTransition } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";

/**
 * 多平台通知目标注册表。Tower 只**存**这张表，不发消息 —— 无人值守下 agent（tower-ask 技能）
 * 据此决定把消息发到哪个渠道；OpenClaw 作网关时，`downstream` 是它转发的下游渠道（如「微信」）。
 */
export interface NotifyTarget {
  id: string;
  label: string;
  platform: "feishu" | "openclaw";
  address: string;
  downstream?: string;
}

const PLATFORMS: NotifyTarget["platform"][] = ["feishu", "openclaw"];

export function HarnessTargetsSection() {
  const { t } = useI18n();
  const [targets, setTargets] = useState<NotifyTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    getConfigValue<NotifyTarget[]>("harness.targets", [])
      .then((v) => setTargets(Array.isArray(v) ? v : []))
      .finally(() => setLoading(false));
  }, []);

  const addTarget = () =>
    setTargets((ts) => [
      ...ts,
      { id: crypto.randomUUID(), label: "", platform: "feishu", address: "" },
    ]);

  const patchTarget = (id: string, patch: Partial<NotifyTarget>) =>
    setTargets((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const removeTarget = (id: string) =>
    setTargets((ts) => ts.filter((x) => x.id !== id));

  const save = () =>
    startSave(async () => {
      // 落库前去掉空行（label 与 address 都为空的）。
      const clean = targets.filter((x) => x.label.trim() || x.address.trim());
      await setConfigValue("harness.targets", clean);
      setTargets(clean);
      toast.success(t("settings.harness.saved"));
    });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{t("settings.harness.title")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.harness.desc")}
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {!loading && targets.length === 0 && (
        <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("settings.harness.empty")}
        </p>
      )}

      <div className="space-y-3">
        {targets.map((tgt) => (
          <div key={tgt.id} className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={tgt.label}
                onChange={(e) => patchTarget(tgt.id, { label: e.target.value })}
                placeholder={t("settings.harness.labelPlaceholder")}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={() => removeTarget(tgt.id)}
                title={t("settings.harness.remove")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={tgt.platform}
                onValueChange={(v) =>
                  patchTarget(tgt.id, { platform: v as NotifyTarget["platform"] })
                }
              >
                <SelectTrigger className="w-36">
                  <span className="truncate">
                    {t(`settings.harness.platform.${tgt.platform}`)}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`settings.harness.platform.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={tgt.address}
                onChange={(e) => patchTarget(tgt.id, { address: e.target.value })}
                placeholder={t("settings.harness.addressPlaceholder")}
                className="flex-1"
              />
            </div>
            {tgt.platform === "openclaw" && (
              <Input
                value={tgt.downstream ?? ""}
                onChange={(e) => patchTarget(tgt.id, { downstream: e.target.value })}
                placeholder={t("settings.harness.downstreamPlaceholder")}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={addTarget} className="text-muted-foreground">
          <Plus className="h-3.5 w-3.5" />
          <span>{t("settings.harness.addTarget")}</span>
        </Button>
        <Button onClick={save} disabled={saving} className="rounded-lg">
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
