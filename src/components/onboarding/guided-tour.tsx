"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { setConfigValue } from "@/actions/config-actions";
import { X } from "lucide-react";

interface TourStep {
  target: string; // data-tour attribute value
  titleKey: string;
  descKey: string;
  placement: "top" | "bottom" | "left" | "right";
  waitForTarget?: boolean; // wait until target appears in DOM
}

const TOUR_STEPS: TourStep[] = [
  {
    target: "create-workspace",
    titleKey: "tour.step1.title",
    descKey: "tour.step1.desc",
    placement: "right",
  },
  {
    target: "create-project",
    titleKey: "tour.step2.title",
    descKey: "tour.step2.desc",
    placement: "bottom",
    waitForTarget: true,
  },
  {
    target: "open-assistant",
    titleKey: "tour.step3.title",
    descKey: "tour.step3.desc",
    placement: "bottom",
  },
];

interface GuidedTourProps {
  onComplete: () => void;
}

export function GuidedTour({ onComplete }: GuidedTourProps) {
  const { t } = useI18n();
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const observerRef = useRef<MutationObserver | null>(null);

  const step = TOUR_STEPS[currentStep];

  const handleComplete = useCallback(async () => {
    await setConfigValue("onboarding.tourCompleted", true);
    onComplete();
  }, [onComplete]);

  const findTarget = useCallback(() => {
    if (!step) return null;
    return document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
  }, [step]);

  const updatePosition = useCallback(() => {
    const el = findTarget();
    if (el) {
      setTargetRect(el.getBoundingClientRect());
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [findTarget]);

  // Watch for target element appearing in DOM (for steps that require navigation first)
  useEffect(() => {
    updatePosition();

    let skipTimer: ReturnType<typeof setTimeout> | null = null;

    if (!visible && step?.waitForTarget) {
      observerRef.current = new MutationObserver(() => {
        const el = findTarget();
        if (el) {
          setTargetRect(el.getBoundingClientRect());
          setVisible(true);
          observerRef.current?.disconnect();
          if (skipTimer) clearTimeout(skipTimer);
        }
      });
      observerRef.current.observe(document.body, { childList: true, subtree: true });

      // Auto-skip after 5s if target never appears (user hasn't navigated there)
      skipTimer = setTimeout(() => {
        const el = findTarget();
        if (!el) {
          setCurrentStep((s) => {
            const next = s + 1;
            return next < TOUR_STEPS.length ? next : s;
          });
          // If it was the last step, complete the tour
          if (currentStep >= TOUR_STEPS.length - 1) {
            handleComplete();
          }
        }
      }, 5000);
    }

    const handleResize = () => updatePosition();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);

    return () => {
      observerRef.current?.disconnect();
      if (skipTimer) clearTimeout(skipTimer);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [currentStep, step, findTarget, updatePosition, visible, handleComplete]);

  // Re-position on any click (user may have navigated)
  useEffect(() => {
    const timer = setInterval(updatePosition, 1000);
    return () => clearInterval(timer);
  }, [updatePosition]);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
      setVisible(false);
    } else {
      handleComplete();
    }
  }, [currentStep]);

  if (!step) return null;

  // Calculate tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) return { display: "none" };

    const gap = 12;
    const style: React.CSSProperties = { position: "fixed", zIndex: 10001 };

    switch (step.placement) {
      case "right":
        style.left = targetRect.right + gap;
        style.top = targetRect.top + targetRect.height / 2;
        style.transform = "translateY(-50%)";
        break;
      case "bottom":
        style.left = targetRect.left + targetRect.width / 2;
        style.top = targetRect.bottom + gap;
        style.transform = "translateX(-50%)";
        break;
      case "left":
        style.right = window.innerWidth - targetRect.left + gap;
        style.top = targetRect.top + targetRect.height / 2;
        style.transform = "translateY(-50%)";
        break;
      case "top":
        style.left = targetRect.left + targetRect.width / 2;
        style.bottom = window.innerHeight - targetRect.top + gap;
        style.transform = "translateX(-50%)";
        break;
    }

    return style;
  };

  return (
    <>
      {/* Overlay with cutout for target element */}
      {visible && targetRect && (
        <>
          {/* Semi-transparent backdrop */}
          <div
            className="fixed inset-0 z-[10000]"
            style={{
              background: `radial-gradient(
                ellipse at ${targetRect.left + targetRect.width / 2}px ${targetRect.top + targetRect.height / 2}px,
                transparent ${Math.max(targetRect.width, targetRect.height)}px,
                rgba(0,0,0,0.6) ${Math.max(targetRect.width, targetRect.height) + 30}px
              )`,
            }}
            onClick={handleNext}
          />

          {/* Highlight ring around target */}
          <div
            className="pointer-events-none fixed z-[10001] rounded-lg ring-2 ring-amber-400 ring-offset-2 ring-offset-background"
            style={{
              left: targetRect.left - 4,
              top: targetRect.top - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
          />

          {/* Tooltip */}
          <div
            className="fixed z-[10002] w-72 rounded-xl border border-border bg-card p-4 shadow-2xl"
            style={getTooltipStyle()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t(step.titleKey as Parameters<typeof t>[0])}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {t(step.descKey as Parameters<typeof t>[0])}
                </p>
              </div>
              <button
                onClick={handleComplete}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between">
              {/* Step indicator */}
              <div className="flex gap-1">
                {TOUR_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full ${
                      i === currentStep ? "bg-amber-400" : i < currentStep ? "bg-amber-400/40" : "bg-muted"
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={handleComplete}
                >
                  {t("tour.skip" as Parameters<typeof t>[0])}
                </Button>
                <Button
                  className="h-7 px-3 text-xs bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
                  onClick={handleNext}
                >
                  {currentStep < TOUR_STEPS.length - 1
                    ? t("tour.next" as Parameters<typeof t>[0])
                    : t("tour.done" as Parameters<typeof t>[0])}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
