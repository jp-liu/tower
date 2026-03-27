// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-serving-test-"));

// Mock process.cwd() before importing file-serve so DATA_ROOT resolves to tmpDir
vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

// Import after mocking cwd
import { resolveAssetPath, MIME_MAP } from "@/lib/file-serve";

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolveAssetPath", () => {
  it("returns resolved path for valid projectId and filename", () => {
    const result = resolveAssetPath("proj1", "image.png");
    expect(result.error).toBeNull();
    expect(result.resolved).not.toBeNull();
    expect(result.resolved).toContain(path.join("data", "assets", "proj1", "image.png"));
  });

  it("rejects path traversal in projectId: ../../etc/passwd", () => {
    const result = resolveAssetPath("../../etc", "passwd");
    expect(result.resolved).toBeNull();
    expect(result.error).toBe("Invalid path");
  });

  it("rejects path traversal in filename: ../../../etc/passwd", () => {
    const result = resolveAssetPath("proj1", "../../../etc/passwd");
    expect(result.resolved).toBeNull();
    expect(result.error).toBe("Invalid path");
  });

  it("returns path under data/assets/ for normal inputs", () => {
    const result = resolveAssetPath("myproject", "report.pdf");
    expect(result.error).toBeNull();
    expect(result.resolved).toMatch(/data[/\\]assets[/\\]myproject[/\\]report\.pdf$/);
  });
});

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

  it("maps .gif to image/gif", () => {
    expect(MIME_MAP[".gif"]).toBe("image/gif");
  });

  it("maps .webp to image/webp", () => {
    expect(MIME_MAP[".webp"]).toBe("image/webp");
  });

  it("maps .svg to image/svg+xml", () => {
    expect(MIME_MAP[".svg"]).toBe("image/svg+xml");
  });

  it("maps .pdf to application/pdf", () => {
    expect(MIME_MAP[".pdf"]).toBe("application/pdf");
  });

  it("maps .txt to text/plain", () => {
    expect(MIME_MAP[".txt"]).toBe("text/plain");
  });

  it("maps .md to text/markdown", () => {
    expect(MIME_MAP[".md"]).toBe("text/markdown");
  });

  it("maps .json to application/json", () => {
    expect(MIME_MAP[".json"]).toBe("application/json");
  });
});
