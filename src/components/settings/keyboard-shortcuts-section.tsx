"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import {
  SHORTCUT_ACTIONS,
  getAction,
  serializeKeyEvent,
  useKeymapStore,
  type ShortcutAction,
  type ShortcutActionId,
} from "@/lib/shortcuts";
import { KeyCombo } from "@/components/shortcuts/key-combo";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

/** Display order for groups. */
const GROUP_ORDER: ReadonlyArray<ShortcutAction["group"]> = [
  "global",
  "panels",
  "missions",
];

/** `missions.cycle` already represents the Tab/Shift+Tab pair in the UI. */
const HIDDEN_ACTION_IDS: ReadonlySet<ShortcutActionId> = new Set([
  "missions.cycleBack",
]);

/** Render a list of tinykeys bindings as polished key caps. */
function KeyChips({ keys }: { keys: string[] }) {
  return <KeyCombo keys={keys} />;
}

export function KeyboardShortcutsSection() {
  const { t } = useI18n();
  // Subscribe to overrides so rows re-render when a binding changes.
  const overrides = useKeymapStore((s) => s.overrides);
  const setBinding = useKeymapStore((s) => s.setBinding);
  const resetBinding = useKeymapStore((s) => s.resetBinding);
  const resetAll = useKeymapStore((s) => s.resetAll);

  // ── Rebind dialog state ──────────────────────────────────────────
  const [editingId, setEditingId] = useState<ShortcutActionId | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  const resolveKeys = (id: ShortcutActionId): string[] =>
    overrides[id] ?? [...getAction(id).defaultKeys];

  // Auto-focus the capture box whenever the dialog opens.
  useEffect(() => {
    if (editingId) {
      // Defer so the dialog content has mounted before focusing.
      const raf = requestAnimationFrame(() => captureRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [editingId]);

  // Conflict map: resolved key → owning actionId (across ALL actions).
  // Recomputed whenever overrides change so warnings stay accurate.
  const keyOwners = useMemo(() => {
    const map = new Map<string, ShortcutActionId>();
    for (const action of SHORTCUT_ACTIONS) {
      const keys = overrides[action.id] ?? [...action.defaultKeys];
      for (const key of keys) {
        if (!map.has(key)) map.set(key, action.id);
      }
    }
    return map;
  }, [overrides]);

  const groups = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      actions: SHORTCUT_ACTIONS.filter(
        (a) => a.group === group && !HIDDEN_ACTION_IDS.has(a.id)
      ),
    })).filter((g) => g.actions.length > 0);
  }, []);

  const editingAction = editingId ? getAction(editingId) : null;
  const conflictId =
    pending && editingId
      ? (() => {
          const owner = keyOwners.get(pending);
          return owner && owner !== editingId ? owner : null;
        })()
      : null;

  function openRebind(id: ShortcutActionId) {
    setPending(null);
    setEditingId(id);
  }

  function closeRebind() {
    setEditingId(null);
    setPending(null);
  }

  function handleSave() {
    if (!editingId || !pending) return;
    // A single captured combo fully replaces the binding array.
    setBinding(editingId, [pending]);
    closeRebind();
    toast.success(t("settings.shortcuts.saved"));
  }

  function handleResetAll() {
    resetAll();
    toast.success(t("settings.shortcuts.resetAllDone"));
  }

  return (
    <div className="space-y-6">
      {/* Header + reset all */}
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">
            {t("settings.keyboardShortcuts")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("settings.keyboardShortcutsDesc")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleResetAll}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t("settings.shortcuts.resetAll")}
        </Button>
      </header>

      {/* Groups */}
      <div className="space-y-6">
        {groups.map(({ group, actions }) => (
          <section key={group}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`shortcuts.group.${group}` as TranslationKey)}
            </h3>
            <ul className="divide-y divide-border/50 rounded-xl border border-border bg-card">
              {actions.map((action) => {
                const hasOverride = action.id in overrides;
                return (
                  <li
                    key={action.id}
                    className="flex items-center justify-between gap-4 px-5 py-3.5"
                  >
                    <span className="min-w-0 flex-1 text-sm">
                      {t(action.descriptionKey as TranslationKey)}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <KeyChips keys={resolveKeys(action.id)} />
                      {action.configurable ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openRebind(action.id)}
                          >
                            {t("settings.shortcuts.rebind")}
                          </Button>
                          {hasOverride && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => resetBinding(action.id)}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Button>
                                }
                              />
                              <TooltipContent>
                                {t("settings.shortcuts.reset")}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("settings.shortcuts.fixed")}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* Rebind dialog */}
      <Dialog
        open={editingId !== null}
        onOpenChange={(open) => !open && closeRebind()}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingAction
                ? t(editingAction.descriptionKey as TranslationKey)
                : t("settings.shortcuts.rebind")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.shortcuts.pressKey")}
            </DialogDescription>
          </DialogHeader>

          {/*
            Capture box is a readOnly <textarea>: focusing a form field makes the
            global dispatcher's bare-key guard suppress app shortcuts while we
            capture. Limitation: modifier combos ($mod+k) bypass that guard, and
            the dispatcher listens in capture phase on window so stopPropagation
            here cannot stop it — a global action may still fire on a modifier
            combo. Accepted for v1 (the captured key is recorded regardless).
          */}
          <textarea
            ref={captureRef}
            readOnly
            tabIndex={0}
            aria-label={t("settings.shortcuts.pressKey")}
            onKeyDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const k = serializeKeyEvent(e.nativeEvent);
              if (k) setPending(k);
            }}
            className="flex h-20 w-full cursor-pointer resize-none items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-center text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />

          <div className="flex min-h-8 items-center justify-center">
            {pending ? (
              <KeyChips keys={[pending]} />
            ) : (
              <span className="text-sm text-muted-foreground">
                {t("settings.shortcuts.pressKey")}
              </span>
            )}
          </div>

          {conflictId && (
            <p className="text-center text-xs text-amber-600 dark:text-amber-400">
              {t("settings.shortcuts.conflict", {
                name: t(getAction(conflictId).descriptionKey as TranslationKey),
              })}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeRebind}>
              {t("settings.shortcuts.cancel")}
            </Button>
            <Button variant="default" onClick={handleSave} disabled={!pending}>
              {t("settings.shortcuts.saveBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
