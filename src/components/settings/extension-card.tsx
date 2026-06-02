"use client";

import { useState } from "react";
import { CheckCircle2, Check, Circle, Copy, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { useExtension } from "@/lib/extensions/client";
import type { ExtensionMetadata } from "@/lib/extensions/types";
import { toast } from "sonner";

interface ExtensionCardProps {
  extension: ExtensionMetadata;
}

/** One platform's install command, shown stacked (label above, command below)
 * with a click-to-copy button. Lives in a Popover so the pointer can move in
 * and the text can be selected/copied (a hover Tooltip dismisses on leave). */
const RIPGREP_INSTALL_COMMANDS: { os: string; cmd: string }[] = [
  { os: "macOS", cmd: "brew install ripgrep" },
  { os: "Windows", cmd: "winget install BurntSushi.ripgrep" },
  { os: "Linux", cmd: "sudo apt install ripgrep" },
];

function CopyCommand({ cmd }: { cmd: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(cmd);
      } else {
        const ta = document.createElement("textarea");
        ta.value = cmd;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  };

  return (
    <div className="flex items-start gap-1 rounded-md bg-background/60 pl-2 pr-1 py-1 ring-1 ring-border/60">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed">{cmd}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground"
        aria-label={t("common.copy")}
        onClick={handleCopy}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
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
        ) : extension.manualInstall ? (
          // Native binary extensions (ripgrep): don't auto-install. Point the
          // user at the project homepage and let them use their OS package
          // manager. The button itself opens the homepage so a misclick on
          // "Install" still does something useful.
          <Popover>
            <PopoverTrigger
              render={(props) => (
                <Button variant="default" {...props}>
                  <Download className="h-3.5 w-3.5" />
                  {t("settings.extensions.installViaHomepage")}
                </Button>
              )}
            />
            <PopoverContent align="start" className="w-80 max-w-[90vw] gap-2 text-xs leading-relaxed">
              <p>{t("settings.extensions.manualInstallHintIntro")}</p>
              <div className="space-y-2">
                {RIPGREP_INSTALL_COMMANDS.map(({ os, cmd }) => (
                  <div key={os} className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">{os}</span>
                    <CopyCommand cmd={cmd} />
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground">{t("settings.extensions.manualInstallHintAfter")}</p>
              <button
                type="button"
                onClick={handleOpenHomepage}
                className="flex items-center gap-1 self-start text-[11px] text-primary underline-offset-2 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {t("settings.extensions.visitHomepage")}
              </button>
            </PopoverContent>
          </Popover>
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
