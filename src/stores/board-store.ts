import { create } from "zustand";
import type { Task, TaskStatus } from "@prisma/client";

type FilterType = "ALL" | "IN_PROGRESS" | "IN_REVIEW";

interface BoardState {
  tasks: Task[];
  filter: FilterType;
  selectedTaskId: string | null;
  setTasks: (tasks: Task[]) => void;
  setFilter: (filter: FilterType) => void;
  setSelectedTaskId: (id: string | null) => void;
  moveTask: (taskId: string, newStatus: TaskStatus) => void;
  getFilteredTasks: () => Task[];
  getTasksByStatus: (status: TaskStatus) => Task[];
}

export const useBoardStore = create<BoardState>((set, get) => ({
  tasks: [],
  filter: "ALL",
  selectedTaskId: null,
  setTasks: (tasks) => set({ tasks }),
  setFilter: (filter) => set({ filter }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  moveTask: (taskId, newStatus) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status: newStatus } : t
      ),
    })),
  getFilteredTasks: () => {
    const { tasks, filter } = get();
    if (filter === "ALL") return tasks;
    return tasks.filter((t) => t.status === filter);
  },
  getTasksByStatus: (status) => {
    return get().getFilteredTasks().filter((t) => t.status === status);
  },
}));
