import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface AiCapabilityBlockProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  badge?: "active" | "coming-soon";
  children: ReactNode;
}

/**
 * Generic shell for one AI capability block in Settings → AI Tools.
 * Pure presentational — no business logic inside.
 */
export function AiCapabilityBlock({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: AiCapabilityBlockProps) {
  const { t } = useI18n();

  return (
    <div
      className={`rounded-xl border border-border bg-card p-4 space-y-3 ${
        badge === "coming-soon" ? "opacity-60" : ""
      }`}
    >
      <div>
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
          {badge === "coming-soon" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Lock className="h-3 w-3" />
              {t("settings.aiCapabilityBlock.comingSoon")}
            </span>
          )}
        </h3>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
