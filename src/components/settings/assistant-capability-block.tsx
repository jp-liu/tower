"use client";

import { useState, useEffect, useTransition } from "react";
import { Bot } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { AiCapabilityBlock } from "./ai-capability-block";

const PRESET_MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
] as const;

const EFFORT_OPTIONS = [
  {
    value: "low",
    labelKey: "settings.assistantCapability.effortLow",
    descKey: "settings.assistantCapability.effortLowDesc",
  },
  {
    value: "medium",
    labelKey: "settings.assistantCapability.effortMedium",
    descKey: "settings.assistantCapability.effortMediumDesc",
  },
  {
    value: "high",
    labelKey: "settings.assistantCapability.effortHigh",
    descKey: "settings.assistantCapability.effortHighDesc",
  },
] as const;

const CUSTOM_MARKER = "__custom__";

export function AssistantCapabilityBlock() {
  const { t } = useI18n();
  const [model, setModel] = useState("sonnet");
  const [effort, setEffort] = useState("low");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    Promise.all([
      getConfigValue("assistant.model", "sonnet"),
      getConfigValue("assistant.effort", "low"),
    ]).then(([m, e]) => {
      if (!alive) return;
      const modelVal = String(m);
      const effortVal = String(e);
      setModel(modelVal);
      setEffort(effortVal);
      // If the stored model isn't in the preset list, treat as custom
      if (!PRESET_MODELS.includes(modelVal as (typeof PRESET_MODELS)[number])) {
        setIsCustomMode(true);
        setCustomInput(modelVal);
      }
      setMounted(true);
    });
    return () => { alive = false; };
  }, []);

  function saveModel(value: string) {
    startTransition(async () => {
      try {
        await setConfigValue("assistant.model", value);
        setModel(value);
        toast.success(t("settings.assistantCapability.updated"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function saveEffort(value: string | null) {
    if (!value) return;
    startTransition(async () => {
      try {
        await setConfigValue("assistant.effort", value);
        setEffort(value);
        toast.success(t("settings.assistantCapability.updated"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function handleModelSelect(value: string | null) {
    if (!value) return;
    if (value === CUSTOM_MARKER) {
      setIsCustomMode(true);
      setCustomInput("");
      return;
    }
    setIsCustomMode(false);
    saveModel(value);
  }

  function handleCustomSubmit() {
    const trimmed = customInput.trim();
    if (!trimmed) {
      setIsCustomMode(false);
      return;
    }
    saveModel(trimmed);
  }

  function handleCustomKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCustomSubmit();
    }
    if (e.key === "Escape") {
      setIsCustomMode(false);
      // Revert to previous model if custom was cancelled
      if (!PRESET_MODELS.includes(model as (typeof PRESET_MODELS)[number])) {
        setCustomInput(model);
      }
    }
  }

  function handleCustomBlur() {
    handleCustomSubmit();
  }

  // Determine what to show on the trigger
  const displayModel = () => {
    if (isCustomMode) {
      return customInput
        ? `${t("settings.assistantCapability.customModel")}: ${customInput}`
        : t("settings.assistantCapability.customModel");
    }
    if (PRESET_MODELS.includes(model as (typeof PRESET_MODELS)[number])) {
      return model;
    }
    return `${t("settings.assistantCapability.customModel")}: ${model}`;
  };

  const effortDisplay = () => {
    const opt = EFFORT_OPTIONS.find((o) => o.value === effort);
    if (!opt) return effort;
    return `${t(opt.labelKey as any)} — ${t(opt.descKey as any)}`;
  };

  if (!mounted) {
    return (
      <AiCapabilityBlock
        icon={Bot}
        title={t("settings.capabilitySlots.assistant")}
        description={t("settings.assistantCapability.modelDesc")}
        badge="active"
      >
        <div className="h-16 rounded-lg bg-muted animate-pulse" />
      </AiCapabilityBlock>
    );
  }

  return (
    <AiCapabilityBlock
      icon={Bot}
      title={t("settings.capabilitySlots.assistant")}
      description={t("settings.assistantCapability.modelDesc")}
      badge="active"
    >
      <div className={`space-y-3 ${isPending ? "opacity-40 pointer-events-none" : ""}`}>
        {/* Model selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.assistantCapability.model")}
          </label>
          {isCustomMode ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={handleCustomKeyDown}
                onBlur={handleCustomBlur}
                placeholder={t("settings.assistantCapability.customModelPlaceholder")}
                className="h-8 flex-1"
              />
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => setIsCustomMode(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <Select value={model} onValueChange={handleModelSelect}>
              <SelectTrigger className="w-full">
                <span className="truncate">{displayModel()}</span>
              </SelectTrigger>
              <SelectContent>
                {PRESET_MODELS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_MARKER}>
                  {t("settings.assistantCapability.customModel")}…
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Effort selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.assistantCapability.effort")}
          </label>
          <Select value={effort} onValueChange={saveEffort}>
            <SelectTrigger className="w-full">
              <span className="truncate">{effortDisplay()}</span>
            </SelectTrigger>
            <SelectContent>
              {EFFORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey as any)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {t("settings.assistantCapability.effortDesc")}
          </p>
        </div>
      </div>
    </AiCapabilityBlock>
  );
}
