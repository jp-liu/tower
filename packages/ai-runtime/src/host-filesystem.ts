import fs from "node:fs";
import type { CliHostFileSystem } from "@tower/ai-sdk";

/** Node implementation supplied by Tower to built-in and community providers alike. */
export class NodeCliHostFileSystem implements CliHostFileSystem {
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  mkdir(directory: string, options?: { recursive?: boolean }): void {
    fs.mkdirSync(directory, { recursive: options?.recursive ?? false });
  }

  readText(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
  }

  writeText(filePath: string, contents: string): void {
    fs.writeFileSync(filePath, contents, "utf8");
  }

  async lstat(filePath: string) {
    return fs.promises.lstat(filePath).catch(() => null);
  }

  readLink(filePath: string): Promise<string> {
    return fs.promises.readlink(filePath);
  }

  symlink(target: string, filePath: string, type?: "dir" | "junction"): Promise<void> {
    return fs.promises.symlink(target, filePath, type);
  }

  unlink(filePath: string): Promise<void> {
    return fs.promises.unlink(filePath);
  }
}
