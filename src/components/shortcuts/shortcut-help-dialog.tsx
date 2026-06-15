"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { SHORTCUT_KEYS, useShortcut, useShortcutHelp } from "@/lib/shortcuts";
import { useShortcutHelpStore } from "@/stores/shortcut-help-store";

/**
 * Keyboard-shortcuts help / cheatsheet dialog. Opened via the framework
 * shortcut (⌘/ or ?) or the command palette's "openHelp" entry; both flow
 * through `useShortcutHelpStore`. Lists every non-hidden registered shortcut
 * grouped by its `group ?? scope`, with platform-aware key chips.
 */
export function ShortcutHelpDialog() {
  const { t } = useI18n();
  const open = useShortcutHelpStore((s) => s.open);
  const setOpen = useShortcutHelpStore((s) => s.setOpen);
  const toggle = useShortcutHelpStore((s) => s.toggle);
  const { groups, renderKeys } = useShortcutHelp();
  const [query, setQuery] = useState("");

  useShortcut([...SHORTCUT_KEYS.help], () => toggle(), {
    scope: "global",
    description: t("shortcuts.openHelp"),
    group: t("shortcuts.group.global"),
  });

  const q = query.trim().toLowerCase();
  const filtered = groups
    .map((group) => ({
      ...group,
      shortcuts: q
        ? group.shortcuts.filter((s) =>
            (s.description ?? "").toLowerCase().includes(q)
          )
        : group.shortcuts,
    }))
    .filter((group) => group.shortcuts.length > 0);

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
          {filtered.map((group) => (
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
                    <span className="truncate">
                      {shortcut.description ?? shortcut.keys.join(", ")}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {renderKeys(shortcut.keys).map((combo, i) => (
                        <kbd
                          key={i}
                          className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                        >
                          {combo}
                        </kbd>
                      ))}
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
