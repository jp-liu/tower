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
  if (ctx.worktreePath) return ctx.worktreePath;
  if (!ctx.projectLocalPath) return null;
  return ctx.subPath ? join(ctx.projectLocalPath, ctx.subPath) : ctx.projectLocalPath;
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
