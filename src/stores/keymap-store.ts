import { create } from "zustand";
import { getAction, type ShortcutActionId } from "@/lib/shortcuts/keymap";

/** localStorage key holding the user's keymap overrides. */
const STORAGE_KEY = "tower-keymap-overrides";

type Overrides = Record<string, string[]>;

/** Load overrides from localStorage (client-only; safe on the server). */
function loadOverrides(): Overrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Overrides;
    }
    return {};
  } catch {
    return {};
  }
}

/** Persist the whole overrides map back to localStorage. */
function persist(overrides: Overrides): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage unavailable (private mode / quota) — keep in-memory state only.
  }
}

/**
 * Pure resolver: the override for `id` if present, otherwise a copy of the
 * action's default keys. Useful for tests and non-hook call sites.
 */
export function resolveKeysFrom(
  overrides: Overrides,
  id: ShortcutActionId
): string[] {
  return overrides[id] ?? [...getAction(id).defaultKeys];
}

interface KeymapState {
  /** actionId → overridden keys. Absent => use the action default. */
  overrides: Overrides;
  /** Set (or replace) the binding for an action and persist. */
  setBinding: (id: ShortcutActionId, keys: string[]) => void;
  /** Remove the override for an action (revert to default) and persist. */
  resetBinding: (id: ShortcutActionId) => void;
  /** Clear all overrides and persist. */
  resetAll: () => void;
  /** Resolve the effective keys for an action (override ?? default). */
  resolveKeys: (id: ShortcutActionId) => string[];
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  overrides: loadOverrides(),
  setBinding: (id, keys) =>
    set((state) => {
      const overrides = { ...state.overrides, [id]: keys };
      persist(overrides);
      return { overrides };
    }),
  resetBinding: (id) =>
    set((state) => {
      if (!(id in state.overrides)) return state;
      const overrides = { ...state.overrides };
      delete overrides[id];
      persist(overrides);
      return { overrides };
    }),
  resetAll: () => {
    persist({});
    set({ overrides: {} });
  },
  resolveKeys: (id) => resolveKeysFrom(get().overrides, id),
}));
