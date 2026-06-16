"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  SHORTCUT_ACTIONS,
  useActionShortcut,
  useKeymapStore,
  resolveKeysFrom,
  type ShortcutAction,
} from "@/lib/shortcuts";
import { KeyCombo } from "@/components/shortcuts/key-combo";
import { useShortcutHelpStore } from "@/stores/shortcut-help-store";

/** Order in which groups appear in the cheatsheet. */
const GROUP_ORDER: ShortcutAction["group"][] = ["global", "missions"];

/** `Shift+Tab` is covered by the `Tab` row — don't list it separately. */
const HIDDEN_ACTIONS = new Set(["missions.cycleBack"]);

/**
 * Keyboard-shortcuts help / cheatsheet dialog. Opened via the framework
 * shortcut (⌘/ or ?) or the command palette's "openHelp" entry; both flow
 * through `useShortcutHelpStore`. Renders the complete action registry grouped
 * by `group` (regardless of route) with the user's live key overrides applied.
 */
export function ShortcutHelpDialog() {
  const { t } = useI18n();
  const open = useShortcutHelpStore((s) => s.open);
  const setOpen = useShortcutHelpStore((s) => s.setOpen);
  const toggle = useShortcutHelpStore((s) => s.toggle);
  const overrides = useKeymapStore((s) => s.overrides);
  const [query, setQuery] = useState("");

  useActionShortcut("global.help", () => toggle());

  const q = query.trim().toLowerCase();

  const groups = GROUP_ORDER.map((group) => {
    const shortcuts = SHORTCUT_ACTIONS.filter(
      (action) => action.group === group && !HIDDEN_ACTIONS.has(action.id)
    )
      .map((action) => ({
        id: action.id,
        description: t(action.descriptionKey as TranslationKey),
        keys: resolveKeysFrom(overrides, action.id),
      }))
      .filter((entry) => (q ? entry.description.toLowerCase().includes(q) : true));
    return {
      title: t(`shortcuts.group.${group}` as TranslationKey),
      shortcuts,
    };
  }).filter((group) => group.shortcuts.length > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.help.title")}</DialogTitle>
        </DialogHeader>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("shortcuts.help.searchPlaceholder")}
        />

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                {group.title}
              </h3>
              <div className="space-y-0.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm"
                  >
                    <span className="truncate">{shortcut.description}</span>
                    <div className="flex shrink-0 items-center">
                      <KeyCombo keys={shortcut.keys} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
