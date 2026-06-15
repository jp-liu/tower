"use client";

import { useKeymapStore } from "@/stores/keymap-store";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { getAction, type ShortcutActionId } from "./keymap";
import { useShortcut } from "./use-shortcut";

interface ActionShortcutOptions {
  when?: () => boolean;
  preventDefault?: boolean;
  priority?: number;
}

/**
 * Read the resolved (override ?? default) keys for an action and subscribe so
 * the component re-renders — and re-registers — when the binding changes.
 */
export function useResolvedKeys(id: ShortcutActionId): string[] {
  const override = useKeymapStore((s) => s.overrides[id]);
  return override ?? [...getAction(id).defaultKeys];
}

/**
 * Register a keyboard shortcut by action id. Scope, description and group come
 * from the action registry; keys come from the keymap store (live overrides).
 * Rebinding in the store re-registers automatically via `useShortcut`'s
 * keys-based dep key.
 */
export function useActionShortcut(
  id: ShortcutActionId,
  handler: (e: KeyboardEvent) => void,
  opts?: ActionShortcutOptions
): void {
  const action = getAction(id);
  const keys = useResolvedKeys(id);
  const { t } = useI18n();

  useShortcut(keys, handler, {
    scope: action.scope,
    description: t(action.descriptionKey as TranslationKey),
    group: t(`shortcuts.group.${action.group}` as TranslationKey),
    allowInInput: action.allowInInput,
    ...opts,
  });
}
