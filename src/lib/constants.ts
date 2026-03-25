import type { TaskStatus } from "@prisma/client";

export const BOARD_COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "TODO", label: "To Do", color: "bg-slate-400" },
  { id: "IN_PROGRESS", label: "In Progress", color: "bg-amber-400" },
  { id: "IN_REVIEW", label: "In Review", color: "bg-sky-400" },
  { id: "DONE", label: "Done", color: "bg-emerald-400" },
  { id: "CANCELLED", label: "Cancelled", color: "bg-rose-400" },
];

export const PRIORITY_CONFIG = {
  LOW: { label: "低", color: "bg-slate-500/20 text-slate-300 border border-slate-500/30" },
  MEDIUM: { label: "中", color: "bg-amber-500/20 text-amber-300 border border-amber-500/30" },
  HIGH: { label: "高", color: "bg-orange-500/20 text-orange-300 border border-orange-500/30" },
  CRITICAL: { label: "紧急", color: "bg-rose-500/20 text-rose-300 border border-rose-500/30" },
} as const;

export const AGENTS = ["CLAUDE_CODE", "MINIMAX"] as const;
export type AgentType = (typeof AGENTS)[number];
