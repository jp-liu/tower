"use server";

import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse as shellParse } from "shell-quote";
import { db } from "@/lib/db";
import { PRESETS } from "@/lib/preview/presets";
import {
  getPreviewKey,
  getPreviewCwd,
  getEffectiveCommand,
  getEffectivePort,
  getCommandSource,
  getPortSource,
  type EffectiveSource,
} from "@/lib/preview/preview-key";
import {
  getOrCreatePreviewSession,
  getPreviewSession,
} from "@/lib/preview/session-store";
import type { PreviewPreset } from "@/lib/preview/preset-types";
import { detectPreset } from "@/lib/preview/detector";
import { readConfigValue } from "@/lib/config-reader";
import { wrapShellCommand } from "@/lib/platform";

interface PreviewStateResp {
  previewKey: string;
  status: string;
  preset: { id: string; name: string; icon: string; docUrl?: string } | null;
  presetSource: "project" | "subPath-detected" | null;
  command: string;
  port: number;
  commandSource: EffectiveSource;
  portSource: EffectiveSource;
  projectDefaultCommand: string | null;
  projectDefaultPort: number | null;
  presetCommand: string | null;
  presetPort: number | null;
  installCommand: string | null;
  url: string | null;
  installed: boolean | null;
  startedAt: number | null;
  readyAt: number | null;
  errorMessage: string | null;
  recentLogs: string[];
  activeSubscribers: number;
  cwd: string | null;
}

function parseCommandLine(cmd: string, port: number): {
  command: string;
  args: string[];
  envOverrides?: Record<string, string>;
} {
  const replaced = cmd.replace(/\{port\}/g, String(port));
  const tokens = shellParse(replaced);

  // shell-quote emits non-string tokens for shell operators (`&&`, `||`, `;`,
  // `|`, redirections) and globs. When any are present, the command must run
  // through a shell so they're interpreted — e.g. `cd ./web && pnpm dev` runs
  // serially instead of being passed as broken args to a single binary.
  // node-pty execs directly without a shell, so we wrap explicitly.
  const needsShell = tokens.some((tok) => typeof tok !== "string");
  if (needsShell) {
    // Inline `KEY=val` assignments are handled by the shell itself; the cwd is
    // passed to pty.spawn separately so `cd ./sub` is relative to that root.
    return wrapShellCommand(replaced);
  }

  // Single command — exec the binary directly (no shell), extracting leading
  // `KEY=value` env assignments into envOverrides. Preserves prior behavior.
  const env: Record<string, string> = {};
  const parts: string[] = [];
  for (const tok of tokens) {
    if (typeof tok !== "string") continue;
    if (parts.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      const idx = tok.indexOf("=");
      env[tok.slice(0, idx)] = tok.slice(idx + 1);
      continue;
    }
    parts.push(tok);
  }
  return {
    command: parts[0] ?? "",
    args: parts.slice(1),
    envOverrides: Object.keys(env).length > 0 ? env : undefined,
  };
}

function checkInstalled(
  preset: PreviewPreset | null,
  cwd: string | null
): boolean | null {
  if (!preset || !preset.installMarker || !cwd) return null;
  return preset.installMarker.some((m) => {
    try {
      return existsSync(join(cwd, m));
    } catch {
      return false;
    }
  });
}

function isMonorepoRoot(projectLocalPath: string): boolean {
  try {
    if (existsSync(join(projectLocalPath, "pnpm-workspace.yaml"))) return true;
    const pkgPath = join(projectLocalPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { workspaces?: unknown };
      if (pkg.workspaces) return true;
    }
  } catch {
    // best-effort
  }
  return false;
}

function getInstallCwd(
  preset: PreviewPreset | null,
  effectiveCwd: string,
  projectLocalPath: string | null
): string {
  if (preset?.installCwd === "monorepo-root" && projectLocalPath) {
    return projectLocalPath;
  }
  if (projectLocalPath && effectiveCwd !== projectLocalPath && isMonorepoRoot(projectLocalPath)) {
    return projectLocalPath;
  }
  return effectiveCwd;
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(port, "0.0.0.0");
  });
}

async function resolveEffective(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
}) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: args.taskId },
    select: {
      previewCommandOverride: true,
      previewPortOverride: true,
      subPath: true,
    },
  });
  const project = await db.project.findUniqueOrThrow({
    where: { id: args.projectId },
    select: {
      localPath: true,
      previewCommand: true,
      previewPort: true,
      previewPreset: true,
      previewInstallCommand: true,
    },
  });

  const cwd = getPreviewCwd({
    worktreePath: args.worktreePath,
    projectLocalPath: project.localPath,
    subPath: task.subPath,
  });

  let preset: PreviewPreset | null = null;
  let presetSource: "project" | "subPath-detected" | null = null;
  if (task.subPath && cwd) {
    preset = await detectPreset(cwd);
    presetSource = preset ? "subPath-detected" : null;
  } else if (project.previewPreset) {
    preset = PRESETS.find((p) => p.id === project.previewPreset) ?? null;
    presetSource = preset ? "project" : null;
  }

  const presetCommand = preset?.command ?? null;
  const presetPort = preset?.port ?? null;
  const command = getEffectiveCommand({
    taskOverride: task.previewCommandOverride,
    projectDefault: project.previewCommand,
    presetCommand,
  });
  const port = getEffectivePort({
    taskOverride: task.previewPortOverride,
    projectDefault: project.previewPort,
    presetPort,
  });
  const commandSource = getCommandSource({
    taskOverride: task.previewCommandOverride,
    projectDefault: project.previewCommand,
    presetCommand,
  });
  const portSource = getPortSource({
    taskOverride: task.previewPortOverride,
    projectDefault: project.previewPort,
    presetPort,
  });
  const installCommand = project.previewInstallCommand ?? preset?.installCommand ?? null;

  return {
    task,
    project,
    preset,
    presetSource,
    cwd,
    command,
    port,
    commandSource,
    portSource,
    projectDefaultCommand: project.previewCommand,
    projectDefaultPort: project.previewPort,
    presetCommand,
    presetPort,
    installCommand,
  };
}

export async function getPreviewState(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
}): Promise<PreviewStateResp> {
  const eff = await resolveEffective(args);

  // T2: background preset auto-detection — must use updateMany (conditional update can't mix id + non-unique field)
  if (!eff.project.previewPreset && !eff.task.subPath && eff.cwd) {
    void (async () => {
      try {
        const detected = await detectPreset(eff.cwd!);
        if (detected) {
          await db.project.updateMany({
            where: { id: args.projectId, previewPreset: null },
            data: { previewPreset: detected.id },
          });
        }
      } catch {
        // best-effort
      }
    })();
  }

  const previewKey = eff.cwd
    ? getPreviewKey({ cwd: eff.cwd, command: eff.command, port: eff.port })
    : "no-cwd";

  const session = getPreviewSession(previewKey);
  const installed = checkInstalled(eff.preset, eff.cwd);

  return {
    previewKey,
    status: session?.status ?? "stopped",
    preset: eff.preset
      ? { id: eff.preset.id, name: eff.preset.name, icon: eff.preset.icon, docUrl: eff.preset.docUrl }
      : null,
    presetSource: eff.presetSource,
    command: eff.command,
    port: eff.port,
    commandSource: eff.commandSource,
    portSource: eff.portSource,
    projectDefaultCommand: eff.projectDefaultCommand,
    projectDefaultPort: eff.projectDefaultPort,
    presetCommand: eff.presetCommand,
    presetPort: eff.presetPort,
    installCommand: eff.installCommand,
    url: session?.getState().url ?? null,
    installed,
    startedAt: session?.getState().startedAt ?? null,
    readyAt: session?.getState().readyAt ?? null,
    errorMessage: session?.getState().errorMessage ?? null,
    recentLogs: session?.getBuffer().slice(-500) ?? [],
    activeSubscribers: session?.activeSubscriberCount ?? 0,
    cwd: eff.cwd,
  };
}

export async function startPreview(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
}): Promise<{ started: boolean; error?: string }> {
  const eff = await resolveEffective(args);
  if (!eff.cwd) return { started: false, error: "No working directory configured" };
  if (!eff.command) return { started: false, error: "No command configured" };
  if (eff.port <= 0) return { started: false, error: "Invalid port" };

  if (await isPortInUse(eff.port)) {
    return {
      started: false,
      error: `Port ${eff.port} is in use. Set Task.previewPortOverride to use a different port, or stop the conflicting process.`,
    };
  }

  const previewKey = getPreviewKey({ cwd: eff.cwd, command: eff.command, port: eff.port });
  const parsed = parseCommandLine(eff.command, eff.port);

  const session = getOrCreatePreviewSession(previewKey, {
    cwd: eff.cwd,
    command: parsed.command,
    args: parsed.args,
    port: eff.port,
    preset: eff.preset,
    envOverrides: parsed.envOverrides,
  });
  return session.run();
}

export async function stopPreview(args: { previewKey: string }): Promise<void> {
  const session = getPreviewSession(args.previewKey);
  if (session) session.stop();
}

export async function installPreviewDeps(args: {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
  autoStartAfter?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const eff = await resolveEffective(args);
  if (!eff.cwd) return { ok: false, error: "No working directory" };
  if (!eff.installCommand) return { ok: false, error: "No install command configured" };

  const previewKey = getPreviewKey({ cwd: eff.cwd, command: eff.command, port: eff.port });
  const installParsed = parseCommandLine(eff.installCommand, eff.port);
  const installCmd = installParsed.command;
  const installArgs = installParsed.args;

  const parsed = parseCommandLine(eff.command, eff.port);
  const session = getOrCreatePreviewSession(previewKey, {
    cwd: eff.cwd,
    command: parsed.command,
    args: parsed.args,
    port: eff.port,
    preset: eff.preset,
    envOverrides: parsed.envOverrides,
  });
  const installCwd = getInstallCwd(eff.preset, eff.cwd, eff.project.localPath);
  return session.install({
    installCommand: installCmd,
    installArgs,
    installCwd,
    autoStartAfter: args.autoStartAfter,
    // TODO(V2): pass installParsed.envOverrides to session.install
  });
}

export async function redetectPreset(args: {
  projectId: string;
  worktreePath?: string | null;
}): Promise<{ preset: string | null }> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: args.projectId },
    select: { localPath: true },
  });
  const cwd = args.worktreePath ?? project.localPath;
  if (!cwd) return { preset: null };
  const detected = await detectPreset(cwd);
  await db.project.update({
    where: { id: args.projectId },
    data: { previewPreset: detected?.id ?? null },
  });
  return { preset: detected?.id ?? null };
}

export async function setProjectDefaults(args: {
  projectId: string;
  command?: string | null;
  port?: number | null;
}): Promise<void> {
  const data: { previewCommand?: string | null; previewPort?: number | null } = {};
  if (args.command !== undefined) data.previewCommand = args.command;
  if (args.port !== undefined) data.previewPort = args.port;
  if (Object.keys(data).length === 0) return;
  await db.project.update({
    where: { id: args.projectId },
    data,
  });
}

export async function setProjectPreset(args: {
  projectId: string;
  presetId: string | null;
}): Promise<void> {
  if (args.presetId && !PRESETS.some((p) => p.id === args.presetId)) {
    throw new Error(`Unknown preset id: ${args.presetId}`);
  }
  await db.project.update({
    where: { id: args.projectId },
    data: { previewPreset: args.presetId },
  });
}

// ─── openInTerminal — cross-platform terminal opener ─────────────────────────
// Uses execFileSync with args array — no shell interpolation (security constraint)

const ALLOWED_TERMINAL_APPS_MACOS = ["Terminal", "iTerm", "iTerm2", "Warp", "Hyper", "Alacritty", "WezTerm", "kitty"];
const ALLOWED_TERMINAL_APPS_WINDOWS = ["cmd", "powershell", "pwsh", "wt", "Windows Terminal"];
const ALLOWED_TERMINAL_APPS_LINUX = ["gnome-terminal", "konsole", "xterm", "alacritty", "kitty", "wezterm", "xfce4-terminal", "tilix"];

export async function openInTerminal(worktreePath: string): Promise<void> {
  if (!worktreePath || !isAbsolute(worktreePath)) {
    throw new Error("openInTerminal requires an absolute path");
  }
  const platform = process.platform;
  if (platform === "darwin") {
    const terminalApp = await readConfigValue<string>("terminal.app", "Terminal");
    if (!ALLOWED_TERMINAL_APPS_MACOS.includes(terminalApp)) {
      throw new Error(`Terminal app '${terminalApp}' is not in the allowed list`);
    }
    execFileSync("open", ["-a", terminalApp, worktreePath]);
  } else if (platform === "win32") {
    const terminalApp = await readConfigValue<string>("terminal.app", "wt");
    if (ALLOWED_TERMINAL_APPS_WINDOWS.includes(terminalApp)) {
      if (terminalApp === "wt" || terminalApp === "Windows Terminal") {
        execFileSync("cmd.exe", ["/c", "start", "wt", "-d", worktreePath]);
      } else if (terminalApp === "powershell" || terminalApp === "pwsh") {
        execFileSync("cmd.exe", ["/c", "start", terminalApp, "-NoExit", "-Command", `Set-Location '${worktreePath}'`]);
      } else {
        execFileSync("cmd.exe", ["/c", "start", "cmd", "/k", `cd /d "${worktreePath}"`]);
      }
    } else {
      throw new Error(`Terminal app '${terminalApp}' is not in the allowed list`);
    }
  } else {
    const terminalApp = await readConfigValue<string>("terminal.app", "xdg-open");
    if (terminalApp === "xdg-open") {
      execFileSync("xdg-open", [worktreePath]);
    } else if (ALLOWED_TERMINAL_APPS_LINUX.includes(terminalApp)) {
      execFileSync(terminalApp, ["--working-directory", worktreePath]);
    } else {
      throw new Error(`Terminal app '${terminalApp}' is not in the allowed list`);
    }
  }
}

// ─── openInFileManager — reveal a directory in the OS file manager ───────────
// Command building (incl. absolute-path guard) lives in open-targets.ts and is
// unit-tested; this layer only spawns. execFileSync with an args array — no
// shell interpolation (security constraint).

export async function openInFileManager(dirPath: string): Promise<void> {
  if (!dirPath || !isAbsolute(dirPath)) {
    throw new Error("openInFileManager requires an absolute path");
  }
  const { buildFileManagerCommand } = await import("@/lib/open-targets");
  const { command, args } = buildFileManagerCommand(process.platform, dirPath);
  // isWindows() (cross-module call), NOT inline `process.platform === "win32"`:
  // Turbopack const-folds the inline form to the build OS and would delete this
  // whole branch, so on Windows explorer.exe would hit execFileSync and throw on
  // its exit-code-1 success. The dynamic import keeps the check truly runtime.
  const { isWindows } = await import("@/lib/platform");
  if (isWindows()) {
    // explorer.exe returns exit code 1 even on success, so execFileSync would
    // throw on a perfectly good open. Fire-and-forget instead — it's a real
    // .exe (no EINVAL risk) and its exit code is meaningless.
    const { spawn } = await import("node:child_process");
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    return;
  }
  execFileSync(command, args);
}

// ─── openInEditor — open a directory as a project in the configured editor ───
// Primary path: spawn the editor CLI (allowlisted in open-targets.ts). When the
// CLI binary isn't resolvable on PATH, fall back to the editor's URL scheme.
// `editor.command` empty → auto-pick the first detected editor.

export async function openInEditor(dirPath: string): Promise<void> {
  if (!dirPath || !isAbsolute(dirPath)) {
    throw new Error("openInEditor requires an absolute path");
  }

  const { buildEditorCommand, buildEditorUrlOpenCommand } = await import("@/lib/open-targets");
  const { resolveEditorBinary, resolveSpawnTarget, detectEditors } = await import("@/lib/platform");

  let editorCommand = await readConfigValue<string>("editor.command", "");
  if (!editorCommand) {
    const detected = (await detectEditors()).filter((e) => e.installed);
    if (detected.length === 0) {
      throw new Error("No editor configured and none detected");
    }
    editorCommand = detected[0].command;
  }

  // Validate against the allowlist (throws if disallowed); cli.args is [dirPath].
  const cli = buildEditorCommand(process.platform, editorCommand, dirPath);

  // Resolve the binary via PATH, then known install locations (so an editor
  // whose CLI shim isn't on PATH — e.g. Sublime's `subl` on macOS — still
  // launches from its .app bundle / default install path).
  const binary = await resolveEditorBinary(cli.command);
  if (binary) {
    // Wrap .cmd/.bat shims through cmd.exe on Windows (Node CVE-2024-27980).
    const target = await resolveSpawnTarget(binary, cli.args);
    execFileSync(target.command, target.args);
    return;
  }

  // Not on PATH and no known install path — fall back to the URL scheme if any.
  const url = buildEditorUrlOpenCommand(process.platform, editorCommand, dirPath);
  execFileSync(url.command, url.args);
}
