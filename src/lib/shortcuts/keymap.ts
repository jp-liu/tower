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
  | "missions.jump"
  | "missions.moveSelection"
  | "missions.cycle"
  | "missions.cycleBack"
  | "missions.focus"
  | "missions.next"
  | "missions.prev"
  | "missions.exit";

export interface ShortcutAction {
  /** Stable identifier — used as the override key and registration key. */
  id: ShortcutActionId;
  /** Default key bindings in tinykeys syntax. */
  defaultKeys: readonly string[];
  /** i18n key for the human-readable description. */
  descriptionKey: string;
  /** Help-panel / settings group. */
  group: "global" | "missions";
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
    defaultKeys: ["$mod+]", "$mod+ArrowRight"],
    descriptionKey: "shortcuts.missions.nextPane",
    group: "missions",
    scope: "missions",
    configurable: true,
    allowInInput: true,
  },
  {
    id: "missions.prev",
    defaultKeys: ["$mod+[", "$mod+ArrowLeft"],
    descriptionKey: "shortcuts.missions.prevPane",
    group: "missions",
    scope: "missions",
    configurable: true,
    allowInInput: true,
  },
  {
    id: "missions.exit",
    defaultKeys: ["Control+;"],
    descriptionKey: "shortcuts.missions.exitToNav",
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
