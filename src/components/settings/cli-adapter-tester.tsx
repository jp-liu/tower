"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Terminal, CheckCircle2, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TestResult } from "@/lib/cli-test";

interface CLIAdapterTesterProps {
  adapterType: string;
  adapterLabel?: string;
}

export function CLIAdapterTester({ adapterType, adapterLabel }: CLIAdapterTesterProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const { t } = useI18n();

  async function handleTestConnection() {
    if (testing) return; // debounce per CLIV-04
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/adapters/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapterType }),
      });
      const data: TestResult = await res.json();
      setResult(data);
    } catch {
      setResult({
        ok: false,
        checks: [{ name: "network_error", passed: false, message: "Network request failed" }],
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Section header with icon */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-emerald-100 dark:bg-emerald-900/30 p-2">
          <Terminal className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold">{t("settings.aiTools.cliVerification")}</h3>
          <p className="text-sm text-muted-foreground">{t("settings.aiTools.cliVerificationDesc")}</p>
        </div>
      </div>

      {/* Adapter card */}
      <Card>
        <CardContent className="p-6 space-y-4">
          {/* Adapter name and test button */}
          <div className="flex items-center justify-between">
            <div>
              {adapterLabel && <p className="font-medium">{adapterLabel}</p>}
            </div>
            <Button
              onClick={handleTestConnection}
              disabled={testing}
              variant="outline"
             
            >
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t("settings.aiTools.testing")}
                </>
              ) : (
                t("settings.aiTools.testConnection")
              )}
            </Button>
          </div>

          {/* Results card -- only shown after test per D-02 */}
          {result && (
            <div
              className={cn(
                "rounded-lg border p-4 space-y-3",
                result.ok
                  ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                  : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
              )}
            >
              {/* Summary line */}
              <div className="flex items-center gap-2">
                {result.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                )}
                <span
                  className={cn(
                    "text-sm font-medium",
                    result.ok
                      ? "text-green-700 dark:text-green-300"
                      : "text-red-700 dark:text-red-300"
                  )}
                >
                  {result.ok ? t("settings.aiTools.testPassed") : t("settings.aiTools.testFailed")}
                </span>
              </div>

              {/* Per-check rows per CLIV-02 */}
              <div className="space-y-2">
                {result.checks.map((check) => (
                  <div
                    key={`${adapterType}-${check.name}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    {check.passed ? (
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    ) : (
                      <X className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    )}
                    <span
                      className={cn(
                        check.passed
                          ? "text-green-700 dark:text-green-300"
                          : "text-red-700 dark:text-red-300"
                      )}
                    >
                      {check.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
