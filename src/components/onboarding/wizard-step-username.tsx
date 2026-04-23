"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface WizardStepUsernameProps {
  onNext: (username: string) => void;
}

export function WizardStepUsername({ onNext }: WizardStepUsernameProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const isDisabled = trimmed.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isDisabled) {
      onNext(trimmed);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t("onboarding.step1.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step1.desc")}</p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="onboarding-username"
          className="text-sm font-medium leading-none"
        >
          {t("onboarding.step1.usernameLabel")}
        </label>
        <input
          id="onboarding-username"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("onboarding.step1.usernamePlaceholder")}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          maxLength={64}
          autoFocus
          autoComplete="username"
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isDisabled}>
          {t("onboarding.step1.next")}
        </Button>
      </div>
    </form>
  );
}
