/**
 * Central binding constants — the single source of truth for all shortcut keys.
 * Bindings use tinykeys syntax. `$mod` resolves to Meta on macOS, Control elsewhere.
 */
export const SHORTCUT_KEYS = {
  search: "$mod+k",
  commandPalette: "$mod+p",
  help: ["$mod+/", "?"],
  missionsJump: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  missionsNext: ["$mod+]", "$mod+ArrowRight"],
  missionsPrev: ["$mod+[", "$mod+ArrowLeft"],
  missionsExit: "$mod+Escape",
  missionsArrows: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  missionsCycle: "Tab",
  missionsCycleBack: "Shift+Tab",
  missionsFocus: "Enter",
} as const;
