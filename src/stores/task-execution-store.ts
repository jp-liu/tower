import { create } from "zustand";

interface ExecutionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
}

interface ExecutionState {
  activeTaskId: string | null;
  isStreaming: boolean;
  messages: ExecutionMessage[];
  fileChanges: { added: number; removed: number };
  setActiveTask: (taskId: string | null) => void;
  addMessage: (msg: ExecutionMessage) => void;
  setMessages: (msgs: ExecutionMessage[]) => void;
  setStreaming: (streaming: boolean) => void;
  setFileChanges: (changes: { added: number; removed: number }) => void;
  reset: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  activeTaskId: null,
  isStreaming: false,
  messages: [],
  fileChanges: { added: 0, removed: 0 },
  setActiveTask: (taskId) => set({ activeTaskId: taskId }),
  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setFileChanges: (changes) => set({ fileChanges: changes }),
  reset: () =>
    set({
      activeTaskId: null,
      isStreaming: false,
      messages: [],
      fileChanges: { added: 0, removed: 0 },
    }),
}));
