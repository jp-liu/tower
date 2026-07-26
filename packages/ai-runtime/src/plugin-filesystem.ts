import { randomUUID } from "node:crypto";
import { constants, promises as fs, type Dirent, type Stats } from "node:fs";
import path from "node:path";

export interface PluginDirectoryEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
}

export interface PluginFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mtimeMs: number;
}

export interface PluginFileSystem {
  readFile(filePath: string): Promise<Buffer>;
  writeFile(filePath: string, data: string | Uint8Array): Promise<void>;
  mkdir(directory: string): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  rm(target: string): Promise<void>;
  stat(target: string): Promise<PluginFileStat>;
  lstat(target: string): Promise<PluginFileStat>;
  realpath(target: string): Promise<string>;
  readdir(directory: string): Promise<PluginDirectoryEntry[]>;
  access(target: string): Promise<void>;
  atomicWrite(filePath: string, data: string): Promise<void>;
  acquireLock(filePath: string): Promise<() => Promise<void>>;
}

function toEntry(entry: Dirent): PluginDirectoryEntry {
  return {
    name: entry.name,
    type: entry.isFile()
      ? "file"
      : entry.isDirectory()
        ? "directory"
        : entry.isSymbolicLink()
          ? "symlink"
          : "other",
  };
}

function toStat(stats: Stats): PluginFileStat {
  return stats;
}

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;

export class NodePluginFileSystem implements PluginFileSystem {
  readFile(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  async writeFile(filePath: string, data: string | Uint8Array): Promise<void> {
    await fs.writeFile(filePath, data);
  }

  async mkdir(directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
  }

  mkdtemp(prefix: string): Promise<string> {
    return fs.mkdtemp(prefix);
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(from, to);
  }

  async rm(target: string): Promise<void> {
    await fs.rm(target, { recursive: true, force: true });
  }

  async stat(target: string): Promise<PluginFileStat> {
    return toStat(await fs.stat(target));
  }

  async lstat(target: string): Promise<PluginFileStat> {
    return toStat(await fs.lstat(target));
  }

  realpath(target: string): Promise<string> {
    return fs.realpath(target);
  }

  async readdir(directory: string): Promise<PluginDirectoryEntry[]> {
    return (await fs.readdir(directory, { withFileTypes: true })).map(toEntry);
  }

  async access(target: string): Promise<void> {
    await fs.access(target, constants.F_OK);
  }

  async atomicWrite(filePath: string, data: string): Promise<void> {
    await this.mkdir(path.dirname(filePath));
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    const directory = await fs.open(path.dirname(filePath), "r").catch(() => null);
    if (directory) {
      await directory.sync().catch(() => undefined);
      await directory.close().catch(() => undefined);
    }
  }

  async acquireLock(filePath: string): Promise<() => Promise<void>> {
    await this.mkdir(path.dirname(filePath));
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await fs.open(filePath, "wx", 0o600);
        const token = `${process.pid}:${randomUUID()}\n`;
        await handle.writeFile(token, "utf8");
        return async () => {
          await handle.close().catch(() => undefined);
          const currentToken = await fs.readFile(filePath, "utf8").catch(() => null);
          if (currentToken === token) await fs.rm(filePath, { force: true }).catch(() => undefined);
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        const stats = await fs.stat(filePath).catch(() => null);
        if (stats && Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
          await fs.rm(filePath, { force: true }).catch(() => undefined);
          continue;
        }
        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) throw new Error("Plugin registry lock timed out");
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
  }
}
