"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CLIAdapterTester } from "@/components/settings/cli-adapter-tester";
import { useI18n } from "@/lib/i18n";
import { completeOnboarding } from "@/actions/onboarding-actions";
import { setConfigValue } from "@/actions/config-actions";
import type { Locale } from "@/lib/i18n";
import type { TestResult } from "@/lib/cli-test";
import type { GitPathRule } from "@/lib/git-url";
import {
  User,
  Terminal,
  GitBranch,
  Check,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  Languages,
  Plus,
  Trash2,
} from "lucide-react";

const TOTAL_STEPS = 3;

/* ─── Right-panel ambient animation (pure CSS) ─── */
function AmbientVisual({ step }: { step: number }) {
  const icons = [User, Terminal, GitBranch];
  const labels = ["Profile", "Connect", "Configure"];
  const Icon = icons[step - 1] ?? User;
  const label = labels[step - 1] ?? "";

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Dot grid background */}
      <div
        className="absolute inset-0 opacity-[0.07] text-white"
        style={{
          backgroundImage:
            "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Large gradient orb — center */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: "380px",
          height: "380px",
          background:
            "radial-gradient(circle, oklch(0.80 0.14 75 / 0.25) 0%, oklch(0.80 0.14 75 / 0.08) 45%, transparent 70%)",
          animation: "ob-pulse 6s ease-in-out infinite",
        }}
      />

      {/* Orbiting ring */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-400/25"
        style={{
          width: "260px",
          height: "260px",
          animation: "ob-spin 20s linear infinite",
        }}
      >
        <div
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-amber-400"
          style={{ boxShadow: "0 0 16px oklch(0.80 0.14 75 / 0.7)" }}
        />
      </div>

      {/* Second orbit — counter direction */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-400/15"
        style={{
          width: "380px",
          height: "380px",
          animation: "ob-spin 30s linear infinite reverse",
        }}
      >
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-amber-400/70" />
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-amber-400/50" />
      </div>

      {/* Floating hexagons */}
      <svg
        className="absolute"
        style={{ top: "18%", right: "22%", animation: "ob-float 8s ease-in-out infinite" }}
        width="44" height="50" viewBox="0 0 40 46" fill="none"
      >
        <path d="M20 1 L38 12 L38 34 L20 45 L2 34 L2 12 Z" stroke="oklch(0.80 0.14 75 / 0.4)" strokeWidth="1.5" fill="oklch(0.80 0.14 75 / 0.06)" />
      </svg>
      <svg
        className="absolute"
        style={{ bottom: "22%", left: "18%", animation: "ob-float 10s ease-in-out 2s infinite" }}
        width="32" height="36" viewBox="0 0 40 46" fill="none"
      >
        <path d="M20 1 L38 12 L38 34 L20 45 L2 34 L2 12 Z" stroke="oklch(0.80 0.14 75 / 0.3)" strokeWidth="1.5" fill="oklch(0.80 0.14 75 / 0.05)" />
      </svg>

      {/* Small floating circles */}
      <div className="absolute h-3.5 w-3.5 rounded-full bg-amber-400/40" style={{ top: "30%", left: "28%", animation: "ob-float 7s ease-in-out 1s infinite" }} />
      <div className="absolute h-2.5 w-2.5 rounded-full bg-amber-400/30" style={{ top: "65%", right: "30%", animation: "ob-float 9s ease-in-out 3s infinite" }} />
      <div className="absolute h-2 w-2 rounded-full bg-amber-400/20" style={{ top: "45%", right: "15%", animation: "ob-float 6s ease-in-out 0.5s infinite" }} />

      {/* Connecting lines */}
      <svg className="absolute inset-0 h-full w-full text-white opacity-[0.12]">
        <line x1="30%" y1="25%" x2="70%" y2="45%" stroke="currentColor" strokeWidth="1" strokeDasharray="4 6" style={{ animation: "ob-dash 12s linear infinite" }} />
        <line x1="65%" y1="30%" x2="35%" y2="70%" stroke="currentColor" strokeWidth="1" strokeDasharray="4 6" style={{ animation: "ob-dash 15s linear infinite reverse" }} />
      </svg>

      {/* Center icon — shifts with step */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/35 bg-amber-500/10 backdrop-blur-sm transition-all duration-700"
          style={{ boxShadow: "0 0 50px oklch(0.80 0.14 75 / 0.2)" }}
        >
          <Icon className="h-7 w-7 text-amber-400" />
        </div>
      </div>

      {/* Step label */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-12 text-center">
        <p className="text-[11px] font-medium tracking-widest uppercase text-amber-400/60">
          {label}
        </p>
      </div>
    </div>
  );
}

/* ─── Git rule form ─── */
interface RuleFormData {
  host: string;
  ownerMatch: string;
  localPathTemplate: string;
}

const EMPTY_RULE: RuleFormData = { host: "", ownerMatch: "*", localPathTemplate: "" };

/** Client-side preview of what a Git URL would resolve to with the current rule */
function previewPath(tpl: string, sampleUrl: string): string {
  if (!tpl || !sampleUrl) return "";
  const trimmed = sampleUrl.trim();
  // Parse: git@host:path.git | ssh://git@host:port/path.git | https://host/path.git
  let segments: string[] = [];
  const sshShort = trimmed.match(/^git@[^:]+:(.+)$/);
  if (sshShort) {
    segments = sshShort[1].replace(/\.git\/?$/, "").split("/").filter(Boolean);
  } else {
    try {
      const url = new URL(trimmed);
      segments = decodeURIComponent(url.pathname).replace(/\.git\/?$/, "").split("/").filter(Boolean);
    } catch {
      return "";
    }
  }
  if (!segments.length) return "";
  const owner = segments[0];
  const repo = segments[segments.length - 1];
  const fullPath = segments.join("/");

  if (tpl.includes("{path}")) {
    return tpl.replace("{path}", fullPath).replace("{owner}", owner).replace("{repo}", repo).replace(/\/+$/, "");
  }
  const base = tpl.replace("{owner}", owner).replace("{repo}", "").replace(/\/+$/, "");
  return `${base}/${repo}`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);

  // Step 1 state
  const [username, setUsername] = useState("");

  // Step 2 state
  const [cliResult, setCliResult] = useState<TestResult | null>(null);

  // Step 3 state
  const [gitRules, setGitRules] = useState<GitPathRule[]>([]);
  const [ruleForm, setRuleForm] = useState<RuleFormData>({ ...EMPTY_RULE });
  const [showRuleForm, setShowRuleForm] = useState(true); // default open
  const [previewIdx, setPreviewIdx] = useState(0);
  const [useFullPath, setUseFullPath] = useState(false);

  // Completion state
  const [completing, setCompleting] = useState(false);

  useEffect(() => setMounted(true), []);

  const themeOptions = [
    { value: "light", label: <Sun className="h-4 w-4" /> },
    { value: "dark", label: <Moon className="h-4 w-4" /> },
    { value: "system", label: <Monitor className="h-4 w-4" /> },
  ] as const;

  const langOptions = [
    { value: "zh" as Locale, label: "中文" },
    { value: "en" as Locale, label: "English" },
  ] as const;

  function handleNextStep() {
    setStep((s) => s + 1);
  }

  function handlePrevStep() {
    setStep((s) => Math.max(1, s - 1));
  }

  function handleAddRule() {
    if (!ruleForm.host.trim() || !ruleForm.localPathTemplate.trim()) return;
    // Build template: user enters base path, we append {path} or leave as-is (auto-append repo)
    const basePath = ruleForm.localPathTemplate.trim().replace(/\/+$/, "");
    const template = useFullPath ? `${basePath}/{path}` : basePath;
    const newRule: GitPathRule = {
      id: crypto.randomUUID(),
      host: ruleForm.host.trim(),
      ownerMatch: ruleForm.ownerMatch.trim() || "*",
      localPathTemplate: template,
      priority: gitRules.length,
    };
    setGitRules((prev) => [...prev, newRule]);
    setRuleForm({ ...EMPTY_RULE });
    setUseFullPath(false);
    setShowRuleForm(false);
  }

  function handleRemoveRule(id: string) {
    setGitRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      // Save git rules if any
      if (gitRules.length > 0) {
        await setConfigValue("git.pathMappingRules", gitRules);
      }
      await completeOnboarding(username.trim());
      // Use replace to avoid back-button returning to onboarding
      router.replace("/workspaces");
    } catch {
      setCompleting(false);
    }
  }

  const stepIcons = [
    { icon: User, label: t("onboarding.step1.title") },
    { icon: Terminal, label: t("onboarding.step2.title") },
    { icon: GitBranch, label: t("onboarding.step3.title") },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* ─── LEFT: Ambient visual ─── */}
      <div className="hidden xl:block xl:w-3/5 border-r border-border/50 bg-[oklch(0.13_0.006_260)]">
        <AmbientVisual step={step} />
      </div>

      {/* ─── RIGHT: Form ─── */}
      <div className="flex w-full flex-col px-8 pt-[10vh] pb-10 xl:w-2/5 xl:px-16 overflow-y-auto">
        <div className="w-full max-w-lg space-y-6">
        {/* Logo + step indicator */}
        <div className="space-y-4">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Tower" className="h-8 w-8 rounded-lg" />
            <span className="text-lg font-semibold tracking-tight">Tower</span>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1.5">
            {stepIcons.map((s, i) => {
              const stepNum = i + 1;
              const isActive = stepNum === step;
              const isDone = stepNum < step;
              const StepIcon = s.icon;
              return (
                <div key={i} className="flex items-center gap-1.5 shrink-0">
                  {i > 0 && (
                    <div
                      className={`h-px w-4 transition-colors duration-500 ${
                        isDone ? "bg-primary" : "bg-border"
                      }`}
                    />
                  )}
                  <div
                    className={`flex items-center gap-1 shrink-0 rounded-full px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-all duration-500 ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : isDone
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? (
                      <Check className="h-3 w-3 shrink-0" />
                    ) : (
                      <StepIcon className="h-3 w-3 shrink-0" />
                    )}
                    <span>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div>
            {/* ─── Step 1: Username + Language + Theme ─── */}
            {step === 1 && (
              <div className="space-y-7 animate-in fade-in slide-in-from-left-4 duration-500">
                <div className="space-y-1.5">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {t("onboarding.step1.title")}
                  </h1>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t("onboarding.step1.desc")}
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="onboarding-username" className="text-sm font-medium">
                    {t("onboarding.step1.usernameLabel")}
                  </label>
                  <input
                    id="onboarding-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t("onboarding.step1.usernamePlaceholder")}
                    className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    maxLength={64}
                    autoFocus
                    autoComplete="username"
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                      <label className="text-sm font-medium">{t("settings.language")}</label>
                    </div>
                    <SegmentedControl
                      options={langOptions.map((o) => ({ value: o.value, label: o.label }))}
                      value={locale}
                      onChange={(v) => setLocale(v as typeof locale)}
                    />
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Sun className="h-3.5 w-3.5 text-muted-foreground" />
                      <label className="text-sm font-medium">{t("settings.theme")}</label>
                    </div>
                    {!mounted ? (
                      <div className="inline-flex h-8 rounded-md border border-border bg-muted p-1 gap-1 w-[120px]" />
                    ) : (
                      <SegmentedControl
                        options={themeOptions.map((o) => ({ value: o.value, label: o.label }))}
                        value={theme ?? "system"}
                        onChange={(v) => setTheme(v)}
                      />
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-3">
                  <Button onClick={handleNextStep} disabled={username.trim().length === 0} className="px-5">
                    {t("onboarding.step1.next")}
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* ─── Step 2: CLI Test ─── */}
            {step === 2 && (
              <div className="space-y-7 animate-in fade-in slide-in-from-left-4 duration-500">
                <div className="space-y-1.5">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {t("onboarding.step2.title")}
                  </h1>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t("onboarding.step2.desc")}
                  </p>
                </div>

                <CLIAdapterTester
                  adapterType="claude_code"
                  adapterLabel="Claude CLI"
                  onResult={setCliResult}
                />

                <div className="flex items-center justify-between pt-3">
                  <Button variant="ghost" className="text-muted-foreground" onClick={handlePrevStep}>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    {t("onboarding.back")}
                  </Button>
                  <Button onClick={handleNextStep} disabled={!cliResult?.ok} className="px-5">
                    {t("onboarding.step1.next")}
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* ─── Step 3: Git Path Rules ─── */}
            {step === 3 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-left-4 duration-500">
                <div className="space-y-1.5">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {t("onboarding.step3.title")}
                  </h1>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t("onboarding.step3.desc")}
                  </p>
                </div>

                {/* Existing rules list */}
                {gitRules.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("onboarding.step3.added").replace("{count}", String(gitRules.length))}
                    </p>
                    {gitRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {rule.host}
                            <span className="text-muted-foreground">
                              {rule.ownerMatch !== "*" ? ` / ${rule.ownerMatch}` : ""}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {rule.localPathTemplate}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveRule(rule.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add rule form — default open */}
                {showRuleForm ? (
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">{t("onboarding.step3.hostLabel")}</label>
                      <Input
                        value={ruleForm.host}
                        onChange={(e) => setRuleForm((f) => ({ ...f, host: e.target.value }))}
                        placeholder={t("onboarding.step3.hostPlaceholder")}
                        className="h-9"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">{t("onboarding.step3.ownerLabel")}</label>
                      <Input
                        value={ruleForm.ownerMatch}
                        onChange={(e) => setRuleForm((f) => ({ ...f, ownerMatch: e.target.value }))}
                        placeholder={t("onboarding.step3.ownerPlaceholder")}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">{t("onboarding.step3.pathLabel")}</label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={ruleForm.localPathTemplate}
                          onChange={(e) => setRuleForm((f) => ({ ...f, localPathTemplate: e.target.value }))}
                          placeholder={t("onboarding.step3.pathPlaceholder")}
                          className="h-9 font-mono text-xs flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setUseFullPath((v) => {
                              if (!v) setPreviewIdx(2);
                              return !v;
                            });
                          }}
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-mono font-medium transition-colors ${
                            useFullPath
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {"{path}"}
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {useFullPath
                          ? t("onboarding.step3.pathHintFull")
                          : t("onboarding.step3.pathHintRepo")}
                      </p>
                    </div>

                    {/* Live preview with sample tabs */}
                    {ruleForm.localPathTemplate && (() => {
                      const basePath = ruleForm.localPathTemplate.trim().replace(/\/+$/, "");
                      const tpl = useFullPath ? `${basePath}/{path}` : basePath;
                      const samples = [
                        { label: "GitHub SSH", url: "git@github.com:user/my-app.git" },
                        { label: "GitHub HTTPS", url: "https://github.com/user/my-app.git" },
                        { label: "GitLab Subgroup", url: "https://gitlab.com/org/team/sub/my-api.git" },
                      ];
                      return (
                        <div className="space-y-2">
                          <label className="text-xs font-medium">{t("onboarding.step3.previewLabel")}</label>
                          <div className="flex gap-1 flex-wrap">
                            {samples.map((s, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setPreviewIdx(i)}
                                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                                  previewIdx === i
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                          <div className="rounded-md bg-muted/50 px-3 py-2 space-y-1">
                            <p className="font-mono text-[11px] text-muted-foreground truncate">
                              {samples[previewIdx].url}
                            </p>
                            <p className="font-mono text-xs">
                              <span className="text-muted-foreground">→ </span>
                              <span className="text-primary">
                                {previewPath(tpl, samples[previewIdx].url)}
                              </span>
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex justify-end gap-2 pt-1">
                      {gitRules.length > 0 && (
                        <Button variant="ghost" onClick={() => setShowRuleForm(false)}>
                          {t("settings.config.git.cancel")}
                        </Button>
                      )}
                      <Button
                        onClick={handleAddRule}
                        disabled={!ruleForm.host.trim() || !ruleForm.localPathTemplate.trim()}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        {t("settings.config.git.save")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setRuleForm({ ...EMPTY_RULE });
                      setShowRuleForm(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {t("settings.config.git.addRule")}
                  </Button>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-3">
                  <Button variant="ghost" className="text-muted-foreground" onClick={handlePrevStep}>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    {t("onboarding.back")}
                  </Button>
                  <Button onClick={handleComplete} disabled={completing} className="px-5">
                    {t("onboarding.complete")}
                    <Check className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
        </div>

        {/* Step counter */}
        <div className="pt-6 text-xs text-muted-foreground">
          {t("onboarding.stepIndicator")
            .replace("{current}", String(step))
            .replace("{total}", String(TOTAL_STEPS))}
        </div>
        </div>
      </div>

    </div>
  );
}
