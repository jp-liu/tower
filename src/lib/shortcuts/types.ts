import type { KeybindingPress } from "tinykeys";

/**
 * Shortcut scope. `"global"` is the lowest-specificity scope; route-specific
 * scopes (e.g. `"missions"`) take priority over `"global"` on the same binding.
 * Open string union — callers may introduce additional scope names.
 */
export type ShortcutScope = "global" | "missions" | (string & {});

export interface ShortcutBinding {
  /**
   * tinykeys syntax, e.g. "$mod+k" | "Control+]" | "1" | "?".
   * May be an array to bind several keys to the same handler.
   */
  keys: string | string[];
  /**
   * Invoked when a bound key fires. The raw KeyboardEvent is passed through so
   * the handler can read `e.key` (e.g. to share one handler across digits 1–9).
   */
  handler: (event: KeyboardEvent) => void;
  /** Defaults to "global". */
  scope?: ShortcutScope;
  /** Description shown in the help panel (pass i18n text). */
  description?: string;
  /** Help-panel group title (i18n text); falls back to `scope` when absent. */
  group?: string;
  /** Extra enable predicate; the binding is inert while it returns false. */
  when?: () => boolean;
  /** Allow bare keys to fire while a form field is focused. */
  allowInInput?: boolean;
  /** Call `event.preventDefault()` on match (default true). */
  preventDefault?: boolean;
  /** Higher fires first within the same scope (default 0). */
  priority?: number;
  /** Hide from the help panel (for internal bindings). */
  hidden?: boolean;
}

export interface RegisteredShortcut extends ShortcutBinding {
  /** Auto-generated unique id. */
  id: string;
  /** Normalized to an array. */
  keys: string[];
  /**
   * Parsed presses, cached at registration time. Each entry of `keys` may parse
   * to one or more presses (multi-press sequences); the dispatcher only handles
   * single-press bindings in v1.
   */
  presses: KeybindingPress[][];
  /** Monotonic registration sequence — used as a tie-break (later wins). */
  seq: number;
}
