/**
 * Action registry — the single source of truth for keyboard shortcuts.
 *
 * Each action has a stable id, default keys (tinykeys syntax), an i18n
 * description, a group/scope, and whether it is user-configurable. User
 * overrides live in `src/stores/keymap-store.ts`; call sites register by
 * action id via `useActionShortcut` and automatically pick up overrides.
 */

export type ShortcutActionId =
  | "global.search"
  | "global.commandPalette"
  | "global.help"
  | "global.assistant"
  | "global.focusAssistant"
  | "global.gotoWorkspace"
  | "panels.taskManager"
  | "panels.assets"
  | "panels.notes"
  | "panels.archive"
  | "missions.exit"
  | "missions.jump"
  | "missions.moveSelection"
  | "missions.cycle"
  | "missions.cycleBack"
  | "missions.focus"
  | "missions.next"
  | "missions.prev";

export interface ShortcutAction {
  /** Stable identifier — used as the override key and registration key. */
  id: ShortcutActionId;
  /** Default key bindings in tinykeys syntax. */
  defaultKeys: readonly string[];
  /** i18n key for the human-readable description. */
  descriptionKey: string;
  /** Help-panel / settings group. */
  group: "global" | "panels" | "missions";
  /** Dispatch scope (route scopes outrank "global" on the same key). */
  scope: "global" | "missions";
  /** `false` => fixed binding, shown read-only in settings. */
  configurable: boolean;
  /** Pass-through to `useShortcut`: allow firing while a form field is focused. */
  allowInInput?: boolean;
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  {
    id: "global.search",
    defaultKeys: ["$mod+k"],
    descriptionKey: "shortcuts.search",
    group: "global",
    scope: "global",
    configurable: true,
  },
  {
    id: "global.commandPalette",
    defaultKeys: ["$mod+p"],
    descriptionKey: "shortcuts.commandPalette",
    group: "global",
    scope: "global",
    configurable: true,
  },
  {
    id: "global.help",
    defaultKeys: ["$mod+/", "?"],
    descriptionKey: "shortcuts.openHelp",
    group: "global",
    scope: "global",
    configurable: true,
  },
  {
    id: "global.assistant",
    defaultKeys: ["$mod+l"],
    descriptionKey: "shortcuts.assistant",
    group: "global",
    scope: "global",
    configurable: true,
  },
  {
    // Move focus INTO the assistant input from anywhere (incl. a focused
    // mission terminal). Opens the panel first if it's closed. Pairs with
    // missions' Ctrl+; (which moves focus OUT to navigation mode).
    id: "global.focusAssistant",
    defaultKeys: ["Control+'"],
    descriptionKey: "shortcuts.focusAssistant",
    group: "global",
    scope: "global",
    configurable: true,
    allowInInput: true,
  },
  {
    id: "global.gotoWorkspace",
    // Alt+1..9 → switch to the Nth workspace. Bound via event.code (DigitN) so
    // it works on macOS where Option+number emits special characters.
    defaultKeys: [
      "Alt+Digit1",
      "Alt+Digit2",
      "Alt+Digit3",
      "Alt+Digit4",
      "Alt+Digit5",
      "Alt+Digit6",
      "Alt+Digit7",
      "Alt+Digit8",
      "Alt+Digit9",
    ],
    descriptionKey: "shortcuts.gotoWorkspace",
    group: "global",
    scope: "global",
    configurable: false,
    allowInInput: true,
  },
  // --- Bottom-left panel entries (mounted app-wide so they work on detail pages too) ---
  // Defaults use Ctrl+Cmd on macOS ($mod = Cmd, Control = Ctrl). The extra
  // Control distinguishes them from the bare $mod combos above (e.g. $mod+k).
  {
    id: "panels.taskManager",
    defaultKeys: ["$mod+Control+j"],
    descriptionKey: "shortcuts.panels.taskManager",
    group: "panels",
    scope: "global",
    configurable: true,
  },
  {
    id: "panels.assets",
    defaultKeys: ["$mod+Control+k"],
    descriptionKey: "shortcuts.panels.assets",
    group: "panels",
    scope: "global",
    configurable: true,
  },
  {
    id: "panels.notes",
    defaultKeys: ["$mod+Control+l"],
    descriptionKey: "shortcuts.panels.notes",
    group: "panels",
    scope: "global",
    configurable: true,
  },
  {
    id: "panels.archive",
    defaultKeys: ["$mod+Control+;"],
    descriptionKey: "shortcuts.panels.archive",
    group: "panels",
    scope: "global",
    configurable: true,
  },
  // --- Mission Control pane navigation (display order matches the help panel) ---
  {
    id: "missions.exit",
    defaultKeys: ["Control+;"],
    descriptionKey: "shortcuts.missions.exitToNav",
    group: "missions",
    scope: "missions",
    configurable: true,
    allowInInput: true,
  },
  {
    id: "missions.jump",
    defaultKeys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    descriptionKey: "shortcuts.missions.jump",
    group: "missions",
    scope: "missions",
    configurable: false,
  },
  {
    id: "missions.moveSelection",
    defaultKeys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    descriptionKey: "shortcuts.missions.moveSel",
    group: "missions",
    scope: "missions",
    configurable: false,
  },
  {
    id: "missions.cycle",
    defaultKeys: ["Tab"],
    descriptionKey: "shortcuts.missions.cyclePane",
    group: "missions",
    scope: "missions",
    configurable: false,
  },
  {
    id: "missions.cycleBack",
    defaultKeys: ["Shift+Tab"],
    descriptionKey: "shortcuts.missions.cyclePane",
    group: "missions",
    scope: "missions",
    configurable: false,
  },
  {
    id: "missions.focus",
    defaultKeys: ["Enter"],
    descriptionKey: "shortcuts.missions.focusSel",
    group: "missions",
    scope: "missions",
    configurable: false,
  },
  {
    id: "missions.next",
    // Only $mod+ArrowRight — $mod+] is left to the browser (forward navigation).
    defaultKeys: ["$mod+ArrowRight"],
    descriptionKey: "shortcuts.missions.nextPane",
    group: "missions",
    scope: "missions",
    configurable: true,
    allowInInput: true,
  },
  {
    id: "missions.prev",
    // Only $mod+ArrowLeft — $mod+[ is left to the browser (back navigation).
    defaultKeys: ["$mod+ArrowLeft"],
    descriptionKey: "shortcuts.missions.prevPane",
    group: "missions",
    scope: "missions",
    configurable: true,
    allowInInput: true,
  },
];

const ACTION_BY_ID = new Map<ShortcutActionId, ShortcutAction>(
  SHORTCUT_ACTIONS.map((action) => [action.id, action])
);

/** Look up an action by id. Throws on an unknown id (programmer error). */
export function getAction(id: ShortcutActionId): ShortcutAction {
  const action = ACTION_BY_ID.get(id);
  if (!action) {
    throw new Error(`Unknown shortcut action: ${id}`);
  }
  return action;
}
