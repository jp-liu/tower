import { create } from "zustand";

interface ShortcutHelpState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/** Open state for the keyboard-shortcuts help / cheatsheet dialog. */
export const useShortcutHelpStore = create<ShortcutHelpState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
