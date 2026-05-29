/**
 * Pure command-building logic for "open in file manager" / "open in editor".
 *
 * These functions only decide WHAT to spawn (command + args). The actual
 * spawning, command-path resolution, and CLI-availability probing live in the
 * server-action layer (preview-actions.ts). Keeping the decision pure makes
 * the platform branching and the security allowlist unit-testable without
 * touching the process table.
 *
 * Dependency-free on purpose (no `node:*` imports) so it's safe to import from
 * client components too — e.g. the Settings page validates the editor field
 * against ALLOWED_EDITOR_COMMANDS.
 */

export interface SpawnDescriptor {
  command: string;
  args: string[];
}

function isAbsolutePath(platform: NodeJS.Platform, dirPath: string): boolean {
  // Platform-specific absolute-path semantics so a Windows path ("C:\\...")
  // still validates on POSIX-only test hosts and vice versa. Implemented
  // inline to keep this module free of node:path (browser-importable).
  if (platform === "win32") {
    return /^[a-zA-Z]:[\\/]/.test(dirPath) || /^\\\\/.test(dirPath);
  }
  return dirPath.startsWith("/");
}

function assertAbsolute(platform: NodeJS.Platform, dirPath: string): void {
  if (!dirPath || !isAbsolutePath(platform, dirPath)) {
    throw new Error("path must be absolute");
  }
}

/** Reveal a directory in the OS file manager. */
export function buildFileManagerCommand(
  platform: NodeJS.Platform,
  dirPath: string,
): SpawnDescriptor {
  assertAbsolute(platform, dirPath);
  if (platform === "darwin") return { command: "open", args: [dirPath] };
  if (platform === "win32") return { command: "explorer", args: [dirPath] };
  return { command: "xdg-open", args: [dirPath] };
}

/**
 * Editor CLI commands Tower is allowed to spawn. Each value is a bare binary
 * name expected on PATH — never a shell string. The allowlist is the security
 * boundary: an attacker-controlled config value can only ever pick one of
 * these, so there is no room for shell-metacharacter injection.
 */
export const ALLOWED_EDITOR_COMMANDS = [
  "code",
  "code-insiders",
  "cursor",
  "windsurf",
  "subl",
  "zed",
  "idea",
  "webstorm",
  "pycharm",
  "goland",
  "rubymine",
  "phpstorm",
  "clion",
  "rider",
] as const;

/**
 * Open a directory as a project in the configured editor's CLI.
 * Throws when the command isn't on the allowlist or the path isn't absolute.
 */
export function buildEditorCommand(
  platform: NodeJS.Platform,
  editorCommand: string,
  dirPath: string,
): SpawnDescriptor {
  if (!(ALLOWED_EDITOR_COMMANDS as readonly string[]).includes(editorCommand)) {
    throw new Error(`Editor command '${editorCommand}' is not allowed`);
  }
  assertAbsolute(platform, dirPath);
  return { command: editorCommand, args: [dirPath] };
}

/**
 * URL scheme per editor CLI, for the fallback path when the CLI binary isn't
 * on PATH but the app is installed and has registered its protocol handler.
 * Editors absent here (terminal editors, JetBrains, Sublime) have no reliable
 * folder-opening scheme — callers must surface an error instead.
 */
const EDITOR_URL_SCHEMES: Record<string, string> = {
  code: "vscode",
  "code-insiders": "vscode-insiders",
  cursor: "cursor",
  windsurf: "windsurf",
  zed: "zed",
};

/** Convert an absolute path to the `<scheme>://file/...` form. */
function pathToFileUrlSuffix(platform: NodeJS.Platform, dirPath: string): string {
  if (platform === "win32") {
    // C:\Users\me\proj → /C:/Users/me/proj
    return "/" + dirPath.replace(/\\/g, "/");
  }
  // /Users/me/proj already starts with a slash
  return dirPath;
}

/**
 * Open a directory in the editor via its registered URL scheme — used only as
 * a fallback when the CLI binary isn't resolvable. Throws when the command is
 * not allowlisted, has no known scheme, or the path isn't absolute.
 */
export function buildEditorUrlOpenCommand(
  platform: NodeJS.Platform,
  editorCommand: string,
  dirPath: string,
): SpawnDescriptor {
  if (!(ALLOWED_EDITOR_COMMANDS as readonly string[]).includes(editorCommand)) {
    throw new Error(`Editor command '${editorCommand}' is not allowed`);
  }
  assertAbsolute(platform, dirPath);
  const scheme = EDITOR_URL_SCHEMES[editorCommand];
  if (!scheme) {
    throw new Error(`Editor '${editorCommand}' has no URL scheme`);
  }
  const url = `${scheme}://file${pathToFileUrlSuffix(platform, dirPath)}`;
  if (platform === "darwin") return { command: "open", args: [url] };
  // Avoid `cmd /c start <url>` — `start` re-parses shell metacharacters in the
  // URL (which embeds a user-controlled path). rundll32's protocol handler
  // takes the URL as a plain arg, no shell, no re-parsing.
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  return { command: "xdg-open", args: [url] };
}
