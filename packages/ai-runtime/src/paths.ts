import os from "node:os";
import { constants as fsConstants, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PlatformName } from "@tower/ai-sdk";
import { isWindows } from "@tower/ai-sdk";

export type RuntimeEnvironment = Record<string, string | undefined>;

export function pathEnvironmentValue(
  env: RuntimeEnvironment,
  platform: PlatformName,
): string {
  if (!isWindows(platform)) return env.PATH ?? "";
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
  return pathKey ? env[pathKey] ?? "" : "";
}

export function windowsPathExtensions(env: RuntimeEnvironment): string[] {
  const key = Object.keys(env).find((name) => name.toLowerCase() === "pathext");
  const value = key ? env[key] : undefined;
  return (value ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => extension.startsWith(".") ? extension : `.${extension}`);
}

export function defaultSupplementalPaths(
  platform: PlatformName,
  env: RuntimeEnvironment = process.env,
  homeDir: string = os.homedir(),
): string[] {
  if (isWindows(platform)) {
    return [
      path.win32.join(env.windir ?? "C:\\Windows", "System32"),
      env.windir ?? "C:\\Windows",
      path.win32.join(env.windir ?? "C:\\Windows", "System32", "Wbem"),
      env.APPDATA ? path.win32.join(env.APPDATA, "npm") : null,
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "Programs") : null,
      env.ProgramFiles ? path.win32.join(env.ProgramFiles, "nodejs") : null,
    ].filter((entry): entry is string => Boolean(entry));
  }

  return [
    path.posix.join(homeDir, ".local", "bin"),
    path.posix.join(homeDir, "bin"),
    path.posix.join(homeDir, ".npm-global", "bin"),
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
}

export function mergePathEnvironment(
  env: RuntimeEnvironment,
  supplementalPaths: string[],
  platform: PlatformName,
): RuntimeEnvironment {
  const delimiter = isWindows(platform) ? ";" : ":";
  const existing = pathEnvironmentValue(env, platform).split(delimiter).filter(Boolean);
  const seen = new Set(existing.map((entry) => isWindows(platform) ? entry.toLowerCase() : entry));
  const merged = [...existing];
  for (const entry of supplementalPaths) {
    const key = isWindows(platform) ? entry.toLowerCase() : entry;
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  const output = { ...env };
  const pathKey = isWindows(platform)
    ? Object.keys(output).find((key) => key.toLowerCase() === "path") ?? "Path"
    : "PATH";
  output[pathKey] = merged.join(delimiter);
  return output;
}

export function expandKnownPath(
  value: string,
  platform: PlatformName,
  env: RuntimeEnvironment,
  homeDir: string,
): string {
  let expanded = value === "~" || value.startsWith("~/") || value.startsWith("~\\")
    ? `${homeDir}${value.slice(1)}`
    : value;
  if (isWindows(platform)) {
    expanded = expanded.replace(/%([^%]+)%/g, (token, variable: string) => {
      const key = Object.keys(env).find((name) => name.toLowerCase() === variable.toLowerCase());
      return key ? env[key] ?? token : token;
    });
    return path.win32.normalize(expanded);
  }
  return path.posix.normalize(expanded);
}

export function commandPathCandidates(
  command: string,
  directories: string[],
  platform: PlatformName,
  env: RuntimeEnvironment,
): string[] {
  const pathImpl = isWindows(platform) ? path.win32 : path.posix;
  if (pathImpl.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return [pathImpl.isAbsolute(command) ? pathImpl.normalize(command) : pathImpl.resolve(command)];
  }
  if (!isWindows(platform)) return directories.map((directory) => pathImpl.join(directory, command));

  const extensions = windowsPathExtensions(env);
  const hasKnownExtension = extensions.some((extension) => command.toLowerCase().endsWith(extension.toLowerCase()));
  return directories.flatMap((directory) => hasKnownExtension
    ? [pathImpl.join(directory, command)]
    : extensions.map((extension) => pathImpl.join(directory, `${command}${extension}`)));
}

export interface FindCommandPathOptions {
  cwd?: string;
  env?: RuntimeEnvironment;
  platform?: PlatformName;
}

export async function findCommandPath(
  command: string,
  options: FindCommandPathOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform as PlatformName;
  const env = options.env ?? process.env;
  const pathImpl = isWindows(platform) ? path.win32 : path.posix;
  const hasSeparator = command.includes("/") || command.includes("\\");
  const candidates = hasSeparator
    ? [pathImpl.isAbsolute(command) ? pathImpl.normalize(command) : pathImpl.resolve(options.cwd ?? process.cwd(), command)]
    : commandPathCandidates(
      command,
      pathEnvironmentValue(env, platform).split(isWindows(platform) ? ";" : ":").filter(Boolean),
      platform,
      env,
    );
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, isWindows(platform) ? fsConstants.F_OK : fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the ordered PATH candidates.
    }
  }
  return null;
}

export type LegacyCommandLookup = (command: string) => string;

export function findCommandPathSync(
  command: string,
  platform: PlatformName = process.platform as PlatformName,
  legacyLookup?: LegacyCommandLookup,
  env: RuntimeEnvironment = process.env,
): string {
  const pathImpl = isWindows(platform) ? path.win32 : path.posix;
  if (pathImpl.extname(command) || command.includes("/") || command.includes("\\")) return command;

  // Kept only for the old injected-test seam. Production discovery never invokes
  // `where`, `which`, or a shell startup script.
  if (legacyLookup) {
    try {
      const matches = legacyLookup(command).split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
      return matches.find((entry) => /\.(?:cmd|bat|exe)$/i.test(entry)) ?? matches[0] ?? command;
    } catch {
      return command;
    }
  }

  const directories = pathEnvironmentValue(env, platform).split(isWindows(platform) ? ";" : ":").filter(Boolean);
  for (const candidate of commandPathCandidates(command, directories, platform, env)) {
    if (existsSync(candidate)) return candidate;
  }
  return command;
}
