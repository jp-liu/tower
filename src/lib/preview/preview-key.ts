import { join } from "node:path";

export type PreviewEffective = {
  cwd: string;
  command: string;
  port: number;
};

export function getPreviewKey(eff: PreviewEffective): string {
  return `${eff.cwd}|${eff.command}|${eff.port}`;
}

export function getPreviewCwd(ctx: {
  worktreePath: string | null;
  projectLocalPath: string | null;
  subPath: string | null;
}): string | null {
  // Mirror agent-actions cwd resolution: base is the worktree (when the task
  // ran in one) else the project root, and subPath is appended in BOTH cases
  // so a monorepo/sub-app dev server runs where its package.json actually lives.
  const base = ctx.worktreePath ?? ctx.projectLocalPath;
  if (!base) return null;
  return ctx.subPath ? join(base, ctx.subPath) : base;
}

export function getEffectiveCommand(ctx: {
  taskOverride: string | null;
  projectDefault: string | null;
  presetCommand: string | null;
}): string {
  return ctx.taskOverride ?? ctx.projectDefault ?? ctx.presetCommand ?? "";
}

export function getEffectivePort(ctx: {
  taskOverride: number | null;
  projectDefault: number | null;
  presetPort: number | null;
}): number {
  return ctx.taskOverride ?? ctx.projectDefault ?? ctx.presetPort ?? 0;
}

export type EffectiveSource = "task" | "project" | "preset" | null;

export function getCommandSource(ctx: {
  taskOverride: string | null;
  projectDefault: string | null;
  presetCommand: string | null;
}): EffectiveSource {
  if (ctx.taskOverride !== null) return "task";
  if (ctx.projectDefault !== null) return "project";
  if (ctx.presetCommand !== null) return "preset";
  return null;
}

export function getPortSource(ctx: {
  taskOverride: number | null;
  projectDefault: number | null;
  presetPort: number | null;
}): EffectiveSource {
  if (ctx.taskOverride !== null) return "task";
  if (ctx.projectDefault !== null) return "project";
  if (ctx.presetPort !== null) return "preset";
  return null;
}
