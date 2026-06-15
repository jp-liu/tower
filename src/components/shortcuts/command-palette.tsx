"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutGrid,
  Settings,
  Plus,
  FolderOpen,
  SunMoon,
  Languages,
  Keyboard,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useI18n } from "@/lib/i18n";
import { SHORTCUT_KEYS, useShortcut } from "@/lib/shortcuts";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useUiDialogStore } from "@/stores/ui-dialog-store";
import { useShortcutHelpStore } from "@/stores/shortcut-help-store";

/**
 * Global command palette (⌘P / Ctrl+P). Open state lives in
 * `useCommandPaletteStore`; selecting any item closes the palette first, then
 * runs its action.
 */
export function CommandPalette() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const toggle = useCommandPaletteStore((s) => s.toggle);

  const setCreateProjectOpen = useUiDialogStore((s) => s.setCreateProjectOpen);
  const setImportProjectOpen = useUiDialogStore((s) => s.setImportProjectOpen);
  const toggleHelp = useShortcutHelpStore((s) => s.toggle);

  useShortcut(SHORTCUT_KEYS.commandPalette, () => toggle(), {
    scope: "global",
    description: t("shortcuts.commandPalette"),
    group: t("shortcuts.group.global"),
  });

  // Close the palette before running the action so focus returns cleanly.
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("palette.title")}>
      <CommandInput placeholder={t("palette.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>

        <CommandGroup heading={t("palette.group.navigation")}>
          <CommandItem onSelect={() => run(() => router.push("/missions"))}>
            <LayoutGrid />
            {t("palette.gotoMissions")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/settings"))}>
            <Settings />
            {t("palette.openSettings")}
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading={t("palette.group.actions")}>
          <CommandItem onSelect={() => run(() => setCreateProjectOpen(true))}>
            <Plus />
            {t("palette.newProject")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => setImportProjectOpen(true))}>
            <FolderOpen />
            {t("palette.importProject")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => toggleHelp())}>
            <Keyboard />
            {t("palette.openHelp")}
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading={t("palette.group.preferences")}>
          <CommandItem
            onSelect={() =>
              run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
            }
          >
            <SunMoon />
            {t("palette.toggleTheme")}
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => setLocale(locale === "zh" ? "en" : "zh"))}
          >
            <Languages />
            {t("palette.toggleLocale")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
