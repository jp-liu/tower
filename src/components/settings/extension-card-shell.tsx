"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ExtensionMetadata } from "@/lib/extensions/types";

interface ExtensionCardShellProps {
  extension: ExtensionMetadata;
  installed: boolean;
  version?: string;
  loading?: boolean;
  children?: ReactNode;
  actions: ReactNode;
}

export function ExtensionCardShell({
  extension,
  installed,
  version,
  loading = false,
  children,
  actions,
}: ExtensionCardShellProps) {
  const { t } = useI18n();
  const Icon = extension.icon;
  const name = extension.nameKey ? t(extension.nameKey) : extension.name;
  const description = extension.descriptionKey ? t(extension.descriptionKey) : extension.description;

  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/50 p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            {extension.hintKey ? (
              <p className="mt-1 text-xs text-muted-foreground/80">{t(extension.hintKey)}</p>
            ) : null}
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
          ~{extension.sizeMB} MB
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs">
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("common.loading")}</span>
          </>
        ) : installed ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-foreground">
              {t("settings.extensions.installed")}
              {version ? ` v${version}` : ""}
            </span>
          </>
        ) : (
          <>
            <Circle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t("settings.extensions.notInstalledShort")}</span>
          </>
        )}
      </div>

      {children ? <div className="mt-4">{children}</div> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
