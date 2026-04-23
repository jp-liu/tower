"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { CLIAdapterTester } from "@/components/settings/cli-adapter-tester";
import { completeOnboarding } from "@/actions/onboarding-actions";
import type { TestResult } from "@/lib/cli-test";

interface WizardStepCliProps {
  username: string;
  onComplete: () => void;
}

export function WizardStepCli({ username, onComplete }: WizardStepCliProps) {
  const { t } = useI18n();
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [completing, setCompleting] = useState(false);

  async function handleComplete() {
    setCompleting(true);
    await completeOnboarding(username);
    onComplete();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t("onboarding.step2.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step2.desc")}</p>
      </div>

      <CLIAdapterTester
        adapterType="claude_code"
        adapterLabel="Claude CLI"
        onResult={setTestResult}
      />

      {testResult && !testResult.ok && (
        <p className="text-sm text-destructive">{t("onboarding.cliRequired")}</p>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleComplete}
          disabled={!testResult?.ok || completing}
        >
          {t("onboarding.complete")}
        </Button>
      </div>
    </div>
  );
}
