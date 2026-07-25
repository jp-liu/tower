// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
import { createAssistantToolBundle } from "../assistant-tool-bundle";

const roots: string[] = [];

async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "tower-assistant-tools-"));
  roots.push(value);
  await fs.mkdir(path.join(value, "2026-07", "files"), { recursive: true });
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

describe("Assistant tool bundle", () => {
  it("adapts catalog Zod schemas and reads only an explicitly attached file", async () => {
    const attachmentRoot = await root();
    await fs.writeFile(path.join(attachmentRoot, "2026-07/files/note.txt"), "hello");
    const handler = vi.fn(async ({ value }: { value: string }) => ({ value }));
    const tools = createAssistantToolBundle({
      attachmentRoot,
      attachments: ["2026-07/files/note.txt"],
      catalog: {
        echo: {
          description: "Echo",
          schema: z.object({ value: z.string() }),
          handler: handler as never,
        },
      },
    });

    await expect(tools.echo!.execute?.({ value: "ok" })).resolves.toEqual({ value: "ok" });
    await expect(tools.read_attachment!.execute?.({ attachment: "2026-07/files/note.txt" }))
      .resolves.toMatchObject({ content: "hello", mimeType: "text/plain", size: 5 });
    await expect(tools.read_attachment!.execute?.({ attachment: "2026-07/files/other.txt" }))
      .rejects.toMatchObject({ code: "tool_error", message: "A tool execution failed" });
  });

  it("blocks traversal, realpath escapes, oversized files, and MIME mismatches", async () => {
    const attachmentRoot = await root();
    const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tower-outside-")), "secret.txt");
    roots.push(path.dirname(outside));
    await fs.writeFile(outside, "secret");
    await fs.symlink(outside, path.join(attachmentRoot, "2026-07/files/link.txt"));
    await fs.writeFile(path.join(attachmentRoot, "2026-07/files/large.txt"), "12345");
    await fs.writeFile(path.join(attachmentRoot, "2026-07/files/binary.txt"), Buffer.from([0, 1, 2]));

    expect(() => createAssistantToolBundle({ attachments: ["../secret.txt"], catalog: {} }))
      .toThrowError(expect.objectContaining({ code: "tool_error" }));
    const tools = createAssistantToolBundle({
      attachmentRoot,
      attachments: [
        "2026-07/files/link.txt",
        "2026-07/files/large.txt",
        "2026-07/files/binary.txt",
      ],
      maxAttachmentBytes: 4,
      catalog: {},
    });
    for (const attachment of ["link.txt", "large.txt", "binary.txt"]) {
      await expect(tools.read_attachment!.execute?.({ attachment: `2026-07/files/${attachment}` }))
        .rejects.toMatchObject({ code: "tool_error", message: "A tool execution failed" });
    }
  });
});
