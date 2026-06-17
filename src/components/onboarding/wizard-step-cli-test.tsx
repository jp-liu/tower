"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Terminal, RotateCw } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TestResult } from "@/lib/cli-test";

interface CliAdapterDef {
  adapterType: string;
  /** Provider name passed to the test API + used as the result key */
  provider: string;
  label: string;
}

/** CLI adapters tested during onboarding. Add entries here to surface more cards. */
const CLI_ADAPTERS: CliAdapterDef[] = [
  { adapterType: "claude_code", provider: "claude", label: "Claude CLI" },
  { adapterType: "codex_cli", provider: "codex", label: "Codex CLI" },
];

interface WizardStepCliTestProps {
  /** Per-provider results owned by the parent (parent derives "passed") */
  results: Record<string, TestResult>;
  /** Reports a single provider's result as soon as its test completes */
  onResult: (provider: string, result: TestResult) => void;
}

/**
 * Compact, batch-capable CLI verification grid for onboarding Step 2.
 * Detection logic/data flow mirrors CLIAdapterTester (POST /api/adapters/test);
 * this only reorganizes the UI into small cards with a one-click "test all".
 */
export function WizardStepCliTest({ results, onResult }: WizardStepCliTestProps) {
  const { t } = useI18n();
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  const anyTesting = CLI_ADAPTERS.some((a) => testing[a.provider]);

  async function testOne(adapter: CliAdapterDef) {
    if (testing[adapter.provider]) return; // debounce per-card
    setTesting((prev) => ({ ...prev, [adapter.provider]: true }));
    try {
      const res = await fetch("/api/adapters/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapterType: adapter.adapterType, provider: adapter.provider }),
      });
      const data: TestResult = await res.json();
      onResult(adapter.provider, data);
    } catch {
      onResult(adapter.provider, {
        ok: false,
        checks: [{ name: "network_error", passed: false, message: "Network request failed" }],
      });
    } finally {
      setTesting((prev) => ({ ...prev, [adapter.provider]: false }));
    }
  }

  async function testAll() {
    await Promise.all(CLI_ADAPTERS.map((a) => testOne(a)));
  }

  return (
    <div className="space-y-3">
      {/* Toolbar: hint + one-click test all */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("onboarding.step2.passHint")}</p>
        <Button variant="outline" onClick={testAll} disabled={anyTesting}>
          {anyTesting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Terminal className="h-4 w-4" />
          )}
          {t("onboarding.step2.testAll")}
        </Button>
      </div>

      {/* Compact card grid — fits common CLI counts without scrolling */}
      <div className="grid grid-cols-2 gap-2">
        {CLI_ADAPTERS.map((adapter) => {
          const isTesting = !!testing[adapter.provider];
          const result = results[adapter.provider];
          const passed = result?.ok === true;
          const failed = result != null && !result.ok;

          // Status line text — constant height to avoid layout shift (ui.md Loading States)
          const failMsg = result?.checks.find((c) => !c.passed)?.message;
          const statusText = isTesting
            ? t("settings.aiTools.testing")
            : passed
              ? t("settings.aiTools.testPassed")
              : failed
                ? failMsg ?? t("settings.aiTools.testFailed")
                : t("onboarding.step2.notTested");
          const fullDetail = failed
            ? result!.checks
                .filter((c) => !c.passed)
                .map((c) => c.message)
                .join("\n")
            : undefined;

          return (
            <div
              key={adapter.provider}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                passed
                  ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20"
                  : failed
                    ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
                    : "border-border bg-muted/30",
              )}
            >
              {/* Status icon — fixed footprint */}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {isTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : passed ? (
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : failed ? (
                  <X className="h-4 w-4 text-red-600 dark:text-red-400" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{adapter.label}</p>
                <p
                  className={cn(
                    "truncate text-xs",
                    passed
                      ? "text-green-700 dark:text-green-300"
                      : failed
                        ? "text-red-700 dark:text-red-300"
                        : "text-muted-foreground",
                  )}
                  title={fullDetail}
                >
                  {statusText}
                </p>
              </div>

              {/* Per-card (re)test */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground"
                      onClick={() => testOne(adapter)}
                      disabled={isTesting}
                    >
                      <RotateCw className="h-4 w-4" />
                    </Button>
                  }
                />
                <TooltipContent>{t("settings.aiTools.testConnection")}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
