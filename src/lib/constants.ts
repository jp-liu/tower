import type { TaskStatus } from "@prisma/client";

export const BOARD_COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "TODO", label: "To Do", color: "bg-gray-500" },
  { id: "IN_PROGRESS", label: "In Progress", color: "bg-blue-500" },
  { id: "IN_REVIEW", label: "In Review", color: "bg-orange-500" },
  { id: "DONE", label: "Done", color: "bg-green-500" },
  { id: "CANCELLED", label: "Cancelled", color: "bg-red-500" },
];

export const PRIORITY_CONFIG = {
  LOW: { label: "低优先级", color: "bg-gray-100 text-gray-600" },
  MEDIUM: { label: "中优先级", color: "bg-purple-100 text-purple-600" },
  HIGH: { label: "高优先级", color: "bg-orange-100 text-orange-600" },
  CRITICAL: { label: "紧急", color: "bg-red-100 text-red-600" },
} as const;

export const AGENTS = ["CLAUDE_CODE", "MINIMAX"] as const;
export type AgentType = (typeof AGENTS)[number];
