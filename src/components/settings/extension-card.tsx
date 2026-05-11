"use client";

import { useState } from "react";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useExtension } from "@/lib/extensions/client";
import type { ExtensionMetadata } from "@/lib/extensions/types";
import { toast } from "sonner";

interface ExtensionCardProps {
  extension: ExtensionMetadata;
}

export function ExtensionCard({ extension }: ExtensionCardProps) {
  const { t } = useI18n();
  const { status, loading, isInstalling, install, uninstall, refresh } = useExtension(extension.id);
  const [refreshing, setRefreshing] = useState(false);

  const Icon = extension.icon;
  const isInstalled = status.installed;

  const handleInstall = async () => {
    const result = await install();
    if (result.success) {
      toast.success(t("settings.extensions.installSuccess").replace("{name}", extension.name));
    } else {
      toast.error(
        t("settings.extensions.installFailed").replace("{name}", extension.name) +
          (result.error ? `: ${result.error.slice(0, 200)}` : "")
      );
    }
  };

  const handleUninstall = async () => {
    const result = await uninstall();
    if (result.success) {
      toast.success(t("settings.extensions.uninstallSuccess").replace("{name}", extension.name));
    } else {
      toast.error(
        t("settings.extensions.uninstallFailed").replace("{name}", extension.name) +
          (result.error ? `: ${result.error.slice(0, 200)}` : "")
      );
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenHomepage = () => {
    window.open(extension.homepageUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-xl border border-border bg-muted/50 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{extension.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{extension.description}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
          ~{extension.sizeMB} MB
        </span>
      </div>

      {/* Status row */}
      <div className="mt-4 flex items-center gap-2 text-xs">
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("common.loading")}</span>
          </>
        ) : isInstalled ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-foreground">
              {t("settings.extensions.installed")}
              {status.version ? ` v${status.version}` : ""}
            </span>
            {status.path && (
              <span className="ml-2 truncate text-muted-foreground" title={status.path}>
                {status.path}
              </span>
            )}
          </>
        ) : (
          <>
            <Circle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t("settings.extensions.notInstalledShort")}</span>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isInstalled ? (
          <>
            <Button
              variant="default"
              onClick={handleInstall}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.extensions.reinstalling")}
                </>
              ) : (
                t("settings.extensions.reinstall")
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleUninstall}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.extensions.uninstalling")}
                </>
              ) : (
                t("settings.extensions.uninstall")
              )}
            </Button>
          </>
        ) : (
          <Button
            variant="default"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("settings.extensions.installing")}
              </>
            ) : (
              t("settings.extensions.install")
            )}
          </Button>
        )}
        <Button variant="ghost" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {t("settings.extensions.recheck")}
        </Button>
        <Button variant="ghost" onClick={handleOpenHomepage}>
          <ExternalLink className="h-3.5 w-3.5" />
          {t("settings.extensions.visitHomepage")}
        </Button>
      </div>
    </div>
  );
}
