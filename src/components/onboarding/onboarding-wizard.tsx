"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { setOnboardingProgress } from "@/actions/onboarding-actions";
import { WizardStepUsername } from "./wizard-step-username";
import { WizardStepCli } from "./wizard-step-cli";

const TOTAL_STEPS = 2;

interface OnboardingWizardProps {
  onComplete: () => void;
  initialStep?: number;
  initialUsername?: string;
}

export function OnboardingWizard({ onComplete, initialStep, initialUsername }: OnboardingWizardProps) {
  const { t } = useI18n();
  const [step, setStep] = useState(initialStep ?? 1);
  const [username, setUsername] = useState(initialUsername ?? "");

  async function handleUsernameNext(name: string) {
    setUsername(name);
    await setOnboardingProgress(1);
    setStep(2);
  }

  const stepIndicator = t("onboarding.stepIndicator")
    .replace("{current}", String(step))
    .replace("{total}", String(TOTAL_STEPS));

  return (
    <Dialog open={true} onOpenChange={() => {}} disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        style={{
          width: "100vw",
          height: "100vh",
          maxWidth: "none",
          top: 0,
          left: 0,
          transform: "none",
          borderRadius: 0,
        }}
      >
        <div className="flex flex-col items-center justify-center h-full">
          <div className="w-full max-w-md px-4 space-y-8">
            {/* Wizard title */}
            <div className="text-center space-y-3">
              <h1 className="text-2xl font-bold">{t("onboarding.title")}</h1>

              {/* Step indicator dots */}
              <div className="flex items-center justify-center gap-2">
                {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                  <div
                    key={i}
                    className={`h-2 w-2 rounded-full transition-colors ${
                      i + 1 === step
                        ? "bg-primary"
                        : i + 1 < step
                        ? "bg-primary/50"
                        : "bg-muted"
                    }`}
                  />
                ))}
              </div>

              <p className="text-xs text-muted-foreground">{stepIndicator}</p>
            </div>

            {/* Step content */}
            {step === 1 && (
              <WizardStepUsername onNext={handleUsernameNext} />
            )}
            {step === 2 && (
              <WizardStepCli username={username} onComplete={onComplete} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
