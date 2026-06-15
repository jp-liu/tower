import { create } from "zustand";

interface UiDialogState {
  createProjectOpen: boolean;
  importProjectOpen: boolean;
  setCreateProjectOpen: (open: boolean) => void;
  setImportProjectOpen: (open: boolean) => void;
}

/**
 * Cross-component open flags for the top-bar's CreateProject / ImportProject
 * dialogs, so the command palette can trigger them without prop drilling.
 * The TopBar subscribes to these and syncs into its local dialog state.
 */
export const useUiDialogStore = create<UiDialogState>((set) => ({
  createProjectOpen: false,
  importProjectOpen: false,
  setCreateProjectOpen: (open) => set({ createProjectOpen: open }),
  setImportProjectOpen: (open) => set({ importProjectOpen: open }),
}));
