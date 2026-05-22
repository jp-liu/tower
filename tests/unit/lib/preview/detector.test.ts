import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectPreset, readPresetFiles } from "@/lib/preview/detector";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("detectPreset", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "preview-detector-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for empty directory", async () => {
    const result = await detectPreset(dir);
    expect(result).toBeNull();
  });

  it("returns null for non-existent directory", async () => {
    const result = await detectPreset("/nonexistent/path/here");
    expect(result).toBeNull();
  });

  it("detects vite project", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { vite: "^5.0.0" } })
    );
    const result = await detectPreset(dir);
    expect(result?.id).toBe("vite");
  });

  it("detects next project (priority over vite when both present)", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { next: "^15.0.0" },
        devDependencies: { vite: "^5.0.0" },
      })
    );
    const result = await detectPreset(dir);
    expect(result?.id).toBe("next");
  });

  it("detects spring-boot-maven from pom.xml", async () => {
    writeFileSync(
      join(dir, "pom.xml"),
      "<project><dependency>spring-boot-starter-web</dependency></project>"
    );
    const result = await detectPreset(dir);
    expect(result?.id).toBe("spring-boot-maven");
  });

  it("detects django from manage.py", async () => {
    writeFileSync(join(dir, "manage.py"), "import django");
    const result = await detectPreset(dir);
    expect(result?.id).toBe("django");
  });

  it("detects static html as fallback", async () => {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    const result = await detectPreset(dir);
    expect(result?.id).toBe("static");
  });

  it("returns null when package.json without recognized dep AND index.html exists", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "test", dependencies: {} })
    );
    writeFileSync(join(dir, "index.html"), "<html></html>");
    const result = await detectPreset(dir);
    expect(result).toBeNull();
  });

  it("survives malformed package.json", async () => {
    writeFileSync(join(dir, "package.json"), "{ not valid json");
    const result = await detectPreset(dir);
    expect(result).toBeNull();
  });
});

describe("readPresetFiles", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "preview-detector-rp-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads only marker files; missing files map to null", async () => {
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    const files = await readPresetFiles(dir);
    expect(files["package.json"]).toBe('{"name":"x"}');
    expect(files["pom.xml"]).toBeNull();
    expect(files["go.mod"]).toBeNull();
  });
});
