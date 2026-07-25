// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("@/actions/config-actions", () => ({ getConfigValue: vi.fn(async () => 1024 * 1024) }));
vi.mock("@/lib/internal-api-guard", () => ({ requireLocalhost: vi.fn(() => null) }));
vi.mock("@/lib/file-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/file-utils")>();
  return {
    ...actual,
    getAssistantCacheRoot: () => state.root,
    getAssistantCacheDir: (kind: "images" | "files") => path.join(state.root, "2026-07", kind),
  };
});

import { POST } from "../route";

const tempDirs: string[] = [];

beforeEach(async () => {
  state.root = await mkdtemp(path.join(tmpdir(), "tower-assistant-upload-"));
  tempDirs.push(state.root);
  await mkdir(path.join(state.root, "2026-07", "files"), { recursive: true });
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Assistant attachment filename redaction", () => {
  it("never persists or returns the user-supplied filename canary", async () => {
    const canary = "CANARY_ATTACHMENT_SECRET_8b21";
    const form = new FormData();
    form.set("file", new File(["safe text"], `${canary}.txt`, { type: "text/plain" }));
    const response = await POST(new NextRequest("http://127.0.0.1/api/internal/assistant/attachments", {
      method: "POST",
      body: form,
    }));
    const payload = await response.json();
    const files = await readdir(path.join(state.root, "2026-07", "files"));
    expect(response.status).toBe(200);
    expect(payload.filename).toMatch(/^2026-07\/files\/tower_image-[0-9a-f]{8}\.txt$/);
    expect(files).toHaveLength(1);
    expect(JSON.stringify({ payload, files })).not.toContain(canary);
  });
});
