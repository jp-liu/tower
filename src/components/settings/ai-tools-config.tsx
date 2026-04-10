"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Check,
  X,
  Terminal,
  CheckCircle2,
  XCircle,
  Star,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TestResult } from "@/lib/cli-test";

const DEFAULT_CLI_ADAPTER_KEY = "ai-manager:default-cli-adapter";

interface CLIAdapter {
  type: string;
  label: string;
}

const CLI_ADAPTERS: CLIAdapter[] = [
  { type: "claude_local", label: "Claude Code" },
];

export function AIToolsConfig() {
  const { t } = useI18n();
  const [defaultAdapter, setDefaultAdapter] = useState("claude_local");
  const [testingAdapter, setTestingAdapter] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    const stored = localStorage.getItem(DEFAULT_CLI_ADAPTER_KEY);
    if (stored) {
      setDefaultAdapter(stored);
    }
  }, []);

  function handleSetDefault(adapterType: string) {
    setDefaultAdapter(adapterType);
    localStorage.setItem(DEFAULT_CLI_ADAPTER_KEY, adapterType);
  }

  async function handleTest(adapterType: string) {
    if (testingAdapter) return;
    setTestingAdapter(adapterType);
    setResults((prev) => {
      const next = { ...prev };
      delete next[adapterType];
      return next;
    });
    try {
      const res = await fetch("/api/adapters/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapterType }),
      });
      const data: TestResult = await res.json();
      setResults((prev) => ({ ...prev, [adapterType]: data }));
    } catch {
      setResults((prev) => ({
        ...prev,
        [adapterType]: {
          ok: false,
          checks: [
            { name: "network_error", passed: false, message: "Network request failed" },
          ],
        },
      }));
    } finally {
      setTestingAdapter(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-emerald-100 dark:bg-emerald-900/30 p-2">
          <Terminal className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold">{t("settings.aiTools.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.aiTools.cliVerificationDesc")}
          </p>
        </div>
      </div>

      {/* Adapter cards */}
      <div className="space-y-3">
        {CLI_ADAPTERS.map((adapter) => {
          const isDefault = defaultAdapter === adapter.type;
          const isTesting = testingAdapter === adapter.type;
          const result = results[adapter.type];

          return (
            <Card key={adapter.type}>
              <CardContent className="p-4 space-y-3">
                {/* Adapter row: name + default badge + actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{adapter.label}</span>
                    {isDefault && (
                      <Badge variant="secondary" className="shrink-0">
                        <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />
                        {t("settings.prompts.default")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefault(adapter.type)}
                      >
                        <Star className="h-4 w-4 mr-1 text-muted-foreground" />
                        {t("settings.prompts.setDefault")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTest(adapter.type)}
                      disabled={isTesting}
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {t("settings.aiTools.testing")}
                        </>
                      ) : (
                        t("settings.aiTools.testConnection")
                      )}
                    </Button>
                  </div>
                </div>

                {/* Test results */}
                {result && (
                  <div
                    className={cn(
                      "rounded-lg border p-4 space-y-3",
                      result.ok
                        ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                        : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                    )}
                  >
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
                        {result.ok
                          ? t("settings.aiTools.testPassed")
                          : t("settings.aiTools.testFailed")}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {result.checks.map((check) => (
                        <div
                          key={`${adapter.type}-${check.name}`}
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
          );
        })}
      </div>
    </div>
  );
}
