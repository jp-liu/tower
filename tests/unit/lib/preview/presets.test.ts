import { describe, it, expect } from "vitest";
import { PRESETS } from "@/lib/preview/presets";

describe("PRESETS", () => {
  it("contains exactly 11 presets", () => {
    expect(PRESETS).toHaveLength(11);
  });

  it("all presets have unique ids", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("vite preset matches package.json with vite dep", () => {
    const vite = PRESETS.find((p) => p.id === "vite")!;
    const result = vite.detect({
      files: {
        "package.json": JSON.stringify({ devDependencies: { vite: "^5.0.0" } }),
      },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("next preset matches package.json with next dep", () => {
    const next = PRESETS.find((p) => p.id === "next")!;
    const result = next.detect({
      files: {
        "package.json": JSON.stringify({ dependencies: { next: "^15.0.0" } }),
      },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("spring-boot-maven matches pom.xml with spring-boot-starter", () => {
    const sb = PRESETS.find((p) => p.id === "spring-boot-maven")!;
    const result = sb.detect({
      files: { "pom.xml": "<dependency>spring-boot-starter-web</dependency>" },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("django matches manage.py existence", () => {
    const dj = PRESETS.find((p) => p.id === "django")!;
    const result = dj.detect({
      files: { "manage.py": "import django" },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("go-generic matches go.mod existence", () => {
    const go = PRESETS.find((p) => p.id === "go-generic")!;
    const result = go.detect({
      files: { "go.mod": "module foo" },
      hasDir: () => false,
    });
    expect(result).toBe(true);
  });

  it("static matches index.html without package.json or pom.xml", () => {
    const st = PRESETS.find((p) => p.id === "static")!;
    expect(
      st.detect({
        files: {
          "index.html": "<html></html>",
          "package.json": null,
          "pom.xml": null,
        },
        hasDir: () => false,
      })
    ).toBe(true);
    expect(
      st.detect({
        files: {
          "index.html": "<html></html>",
          "package.json": JSON.stringify({}),
          "pom.xml": null,
        },
        hasDir: () => false,
      })
    ).toBe(false);
  });

  it("vite preset's readyRegex matches real Vite output", () => {
    const vite = PRESETS.find((p) => p.id === "vite")!;
    expect(vite.readyRegex!.test("  VITE v5.0.0  ready in 1247 ms")).toBe(true);
  });

  it("vite preset's urlExtractRegex extracts URL from Local: line", () => {
    const vite = PRESETS.find((p) => p.id === "vite")!;
    const m = "  ➜  Local:   http://localhost:5173/".match(vite.urlExtractRegex!);
    expect(m?.[1]).toBe("http://localhost:5173/");
  });

  it("spring-boot readyRegex matches real Spring Boot output", () => {
    const sb = PRESETS.find((p) => p.id === "spring-boot-maven")!;
    expect(
      sb.readyRegex!.test(
        "Started DemoApplication in 2.345 seconds (process running for 3.456)"
      )
    ).toBe(true);
  });

  it("django readyRegex matches real Django output", () => {
    const dj = PRESETS.find((p) => p.id === "django")!;
    expect(
      dj.readyRegex!.test("Starting development server at http://127.0.0.1:8000/")
    ).toBe(true);
  });

  it("spring-boot-maven has startTimeoutMs override (>= 120s)", () => {
    const sb = PRESETS.find((p) => p.id === "spring-boot-maven")!;
    expect(sb.startTimeoutMs).toBeGreaterThanOrEqual(120_000);
  });

  it("go-generic has null readyRegex (falls back to HTTP probe)", () => {
    const go = PRESETS.find((p) => p.id === "go-generic")!;
    expect(go.readyRegex).toBeNull();
  });
});
