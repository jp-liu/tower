"use client";

import { useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { listExtensionMetadata } from "@/lib/extensions/metadata";
import { installExtension } from "@/actions/extension-actions";
import {
  completeOnboarding,
  setOnboardingExtensions,
} from "@/actions/onboarding-actions";
import type { ExtensionId } from "@/lib/extensions/types";

interface WizardStepExtensionsProps {
  username: string;
  onComplete: () => void;
}

export function WizardStepExtensions({ username, onComplete }: WizardStepExtensionsProps) {
  const { t } = useI18n();
  const extensions = listExtensionMetadata();

  // Default: all extensions checked. State is the set of currently-checked ids.
  const [selected, setSelected] = useState<Set<ExtensionId>>(
    () => new Set(extensions.map((e) => e.id))
  );
  const [installing, setInstalling] = useState(false);

  const allCount = extensions.length;
  const selectedCount = selected.size;
  const someUnchecked = selectedCount < allCount;

  const toggle = (id: ExtensionId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  async function handleFinish() {
    setInstalling(true);
    const requested = Array.from(selected);
    const completed: string[] = [];

    if (requested.length > 0) {
      // Install in parallel; collect successes
      const results = await Promise.all(
        requested.map(async (id) => {
          try {
            const result = await installExtension(id);
            return { id, success: result.success };
          } catch {
            return { id, success: false };
          }
        })
      );
      for (const r of results) {
        if (r.success) completed.push(r.id);
      }
    }

    // Persist selections + actual results
    await setOnboardingExtensions(requested, completed);
    // Mark onboarding done with username
    await completeOnboarding(username);
    setInstalling(false);
    onComplete();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t("onboarding.step4.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step4.desc")}</p>
      </div>

      <div className="space-y-2">
        {extensions.map((ext) => {
          const Icon = ext.icon;
          const checked = selected.has(ext.id);
          return (
            <label
              key={ext.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(ext.id)}
                disabled={installing}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
              />
              <div className="flex flex-1 items-start gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{ext.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">~{ext.sizeMB} MB</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{ext.description}</p>
                  <a
                    href={ext.homepageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("settings.extensions.visitHomepage")}
                  </a>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {someUnchecked && (
        <p className="text-xs text-muted-foreground italic">
          {t("onboarding.step4.skipHint")}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleFinish} disabled={installing}>
          {installing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("onboarding.step4.installing")}
            </>
          ) : selectedCount === 0 ? (
            t("onboarding.step4.continueWithoutInstall")
          ) : (
            t("onboarding.step4.continue")
          )}
        </Button>
      </div>
    </div>
  );
}
