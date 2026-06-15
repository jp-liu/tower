export { ShortcutProvider } from "./shortcut-provider";
export { useShortcut } from "./use-shortcut";
export { useShortcutHelp, renderKeys, isMac } from "./use-shortcut-help";
export type { ShortcutHelpGroup } from "./use-shortcut-help";
export {
  useShortcutStore,
  selectAllShortcuts,
} from "./shortcut-store";
export {
  resolveShortcut,
  isFormField,
  isModifierCombo,
} from "./shortcut-dispatcher";
export type {
  ShortcutScope,
  ShortcutBinding,
  RegisteredShortcut,
} from "./types";

// Action registry (user-configurable keymap layer).
export {
  SHORTCUT_ACTIONS,
  getAction,
  type ShortcutAction,
  type ShortcutActionId,
} from "./keymap";
export { useActionShortcut, useResolvedKeys } from "./use-action-shortcut";
export { serializeKeyEvent, formatKeysList } from "./serialize-keys";
export { useKeymapStore, resolveKeysFrom } from "@/stores/keymap-store";
