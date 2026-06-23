// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import * as path from "node:path";

// Mock tower-dir to return a predictable path
vi.mock("../tower-dir", () => ({
  getStorageDir: () => "/mock/tower/storage",
  getTowerDbFilePath: () => "/mock/tower/database/tower.db",
  getDatabaseDir: () => "/mock/tower/database",
}));

import { resolveAssetPath, MIME_MAP } from "../file-serve";
import { localPathToApiUrl } from "../file-serve-client";

// ── resolveAssetPath ──

describe("resolveAssetPath — valid paths", () => {
  it("returns resolved path under storage/assets/{projectId} for a simple filename", () => {
    const { resolved, error } = resolveAssetPath("proj123", "image.png");
    expect(error).toBeNull();
    expect(resolved).not.toBeNull();
    expect(resolved!).toContain(path.join("storage", "assets", "proj123", "image.png"));
  });

  it("returns resolved path for filename with spaces", () => {
    const { resolved, error } = resolveAssetPath("proj123", "my file.png");
    expect(error).toBeNull();
    expect(resolved!).toContain("my file.png");
  });

  it("returns resolved path for nested filename without traversal", () => {
    const { resolved, error } = resolveAssetPath("proj123", "subdir/image.png");
    if (error === null) {
      expect(resolved!).toContain(path.join("storage", "assets", "proj123"));
    } else {
      expect(error).toBe("Invalid path");
    }
  });
});

describe("resolveAssetPath — path traversal blocking", () => {
  it("blocks simple directory traversal '../../../etc/passwd'", () => {
    const { resolved, error } = resolveAssetPath("proj123", "../../../etc/passwd");
    expect(resolved).toBeNull();
    expect(error).toBe("Invalid path");
  });

  it("blocks traversal attempting to escape project directory '../../../etc'", () => {
    const { resolved, error } = resolveAssetPath("proj123", "../../etc");
    expect(resolved).toBeNull();
    expect(error).toBe("Invalid path");
  });

  it("blocks traversal via nested relative path 'sub/../../../etc/passwd'", () => {
    const { resolved, error } = resolveAssetPath("proj123", "sub/../../../etc/passwd");
    expect(resolved).toBeNull();
    expect(error).toBe("Invalid path");
  });

  it("allows single level up traversal that stays within storage/assets", () => {
    const { resolved, error } = resolveAssetPath("proj123", "../sibling-proj/secret.txt");
    expect(error).toBeNull();
    expect(resolved).not.toBeNull();
    expect(resolved!).toContain(path.join("storage", "assets", "sibling-proj", "secret.txt"));
  });

  it("blocks absolute path '/etc/passwd'", () => {
    const { resolved, error } = resolveAssetPath("proj123", "/etc/passwd");
    expect(resolved).toBeNull();
    expect(error).toBe("Invalid path");
  });
});

// ── MIME_MAP ──

describe("MIME_MAP", () => {
  it("maps .png to image/png", () => {
    expect(MIME_MAP[".png"]).toBe("image/png");
  });

  it("maps .jpg to image/jpeg", () => {
    expect(MIME_MAP[".jpg"]).toBe("image/jpeg");
  });

  it("maps .jpeg to image/jpeg", () => {
    expect(MIME_MAP[".jpeg"]).toBe("image/jpeg");
  });

  it("maps .svg to image/svg+xml", () => {
    expect(MIME_MAP[".svg"]).toBe("image/svg+xml");
  });

  it("maps .gif to image/gif", () => {
    expect(MIME_MAP[".gif"]).toBe("image/gif");
  });

  it("maps .webp to image/webp", () => {
    expect(MIME_MAP[".webp"]).toBe("image/webp");
  });

  it("maps .pdf to application/pdf", () => {
    expect(MIME_MAP[".pdf"]).toBe("application/pdf");
  });

  it("maps .json to application/json", () => {
    expect(MIME_MAP[".json"]).toBe("application/json");
  });

  it("maps .txt to text/plain", () => {
    expect(MIME_MAP[".txt"]).toBe("text/plain");
  });

  it("maps .md to text/markdown", () => {
    expect(MIME_MAP[".md"]).toBe("text/markdown");
  });

  it("returns undefined for unknown extension .unknown", () => {
    expect(MIME_MAP[".unknown"]).toBeUndefined();
  });

  it("returns undefined for .exe (not in map)", () => {
    expect(MIME_MAP[".exe"]).toBeUndefined();
  });

  it("returns undefined for empty string key", () => {
    expect(MIME_MAP[""]).toBeUndefined();
  });
});

// ── localPathToApiUrl ──

describe("localPathToApiUrl", () => {
  it("converts storage/assets path to API URL", () => {
    const result = localPathToApiUrl("/Users/alice/.tower/storage/assets/abc123/file.png");
    expect(result).toBe("/api/files/assets/abc123/file.png");
  });

  it("converts relative storage/assets path to API URL", () => {
    const result = localPathToApiUrl("storage/assets/abc123/file.png");
    expect(result).toBe("/api/files/assets/abc123/file.png");
  });

  it("converts legacy data/assets path to API URL (backward compat)", () => {
    const result = localPathToApiUrl("data/assets/abc123/file.png");
    expect(result).toBe("/api/files/assets/abc123/file.png");
  });

  it("converts path with leading slash /data/assets/... to API URL", () => {
    const result = localPathToApiUrl("/data/assets/abc123/file.png");
    expect(result).toBe("/api/files/assets/abc123/file.png");
  });

  it("converts absolute path ending in data/assets/... to API URL", () => {
    const result = localPathToApiUrl("/absolute/path/to/data/assets/abc123/file.png");
    expect(result).toBe("/api/files/assets/abc123/file.png");
  });

  it("returns input unchanged for unrelated path 'unrelated/path.png'", () => {
    const result = localPathToApiUrl("unrelated/path.png");
    expect(result).toBe("unrelated/path.png");
  });

  it("returns input unchanged for external URL", () => {
    const url = "https://example.com/image.png";
    expect(localPathToApiUrl(url)).toBe(url);
  });

  it("returns input unchanged for path that doesn't match pattern", () => {
    const p = "cache/abc123/file.png";
    expect(localPathToApiUrl(p)).toBe(p);
  });

  it("converts path with project ID containing numbers and letters", () => {
    const result = localPathToApiUrl("storage/assets/clh1234567890abcdefghij/screenshot.jpg");
    expect(result).toBe("/api/files/assets/clh1234567890abcdefghij/screenshot.jpg");
  });

  it("returns input unchanged for empty string", () => {
    expect(localPathToApiUrl("")).toBe("");
  });

  it("converts a Windows backslash storage path (otherwise breaks on Windows)", () => {
    const result = localPathToApiUrl(
      "C:\\Users\\bob\\.tower\\storage\\assets\\abc123\\file.png"
    );
    expect(result).toBe("/api/files/assets/abc123/file.png");
  });

  it("converts a relocated storage root (no 'storage'/'data' segment)", () => {
    const result = localPathToApiUrl("/mnt/d/TowerFiles/assets/abc123/file.png");
    expect(result).toBe("/api/files/assets/abc123/file.png");
  });

  it("converts a Windows relocated-drive path", () => {
    const result = localPathToApiUrl("D:\\TowerFiles\\assets\\abc123\\doc.md");
    expect(result).toBe("/api/files/assets/abc123/doc.md");
  });
});
