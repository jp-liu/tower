// @vitest-environment node
import { describe, it, expect } from "vitest";
import { localPathToApiUrl } from "@/lib/file-serve";

describe("localPathToApiUrl", () => {
  it("transforms data/assets/{projectId}/{filename} to API URL", () => {
    const result = localPathToApiUrl("data/assets/proj1/image.png");
    expect(result).toBe("/api/files/assets/proj1/image.png");
  });

  it("transforms /data/assets/{projectId}/{filename} to API URL (leading slash)", () => {
    const result = localPathToApiUrl("/data/assets/proj1/image.png");
    expect(result).toBe("/api/files/assets/proj1/image.png");
  });

  it("passes through https:// URLs unchanged", () => {
    const result = localPathToApiUrl("https://example.com/img.png");
    expect(result).toBe("https://example.com/img.png");
  });

  it("passes through http:// URLs unchanged", () => {
    const result = localPathToApiUrl("http://example.com/img.png");
    expect(result).toBe("http://example.com/img.png");
  });

  it("passes through already-API URLs unchanged", () => {
    const result = localPathToApiUrl("/api/files/assets/proj1/image.png");
    expect(result).toBe("/api/files/assets/proj1/image.png");
  });

  it("passes through random text unchanged", () => {
    const result = localPathToApiUrl("random text");
    expect(result).toBe("random text");
  });

  it("transforms paths with different extensions", () => {
    const result = localPathToApiUrl("data/assets/myproj/report.pdf");
    expect(result).toBe("/api/files/assets/myproj/report.pdf");
  });
});
