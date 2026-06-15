import { create } from "zustand";
import { parseKeybinding } from "tinykeys";
import type { ShortcutBinding, RegisteredShortcut } from "./types";

let idCounter = 0;
let seqCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `sc_${idCounter}`;
}

function normalizeKeys(keys: string | readonly string[]): string[] {
  return Array.isArray(keys) ? [...keys] : [keys as string];
}

/** Parse each key binding string once and cache the presses. */
function parsePresses(keys: string[]): RegisteredShortcut["presses"] {
  return keys.map((k) => parseKeybinding(k));
}

interface ShortcutStoreState {
  entries: Map<string, RegisteredShortcut>;
  register: (binding: ShortcutBinding) => string;
  unregister: (id: string) => void;
}

export const useShortcutStore = create<ShortcutStoreState>((set) => ({
  entries: new Map(),
  register: (binding) => {
    const id = nextId();
    seqCounter += 1;
    const keys = normalizeKeys(binding.keys);
    const entry: RegisteredShortcut = {
      ...binding,
      id,
      keys,
      presses: parsePresses(keys),
      seq: seqCounter,
    };
    set((state) => {
      const entries = new Map(state.entries);
      entries.set(id, entry);
      return { entries };
    });
    return id;
  },
  unregister: (id) => {
    set((state) => {
      if (!state.entries.has(id)) return state;
      const entries = new Map(state.entries);
      entries.delete(id);
      return { entries };
    });
  },
}));

/** Read all registered shortcuts as an array (selector-friendly). */
export function selectAllShortcuts(
  state: ShortcutStoreState
): RegisteredShortcut[] {
  return Array.from(state.entries.values());
}
