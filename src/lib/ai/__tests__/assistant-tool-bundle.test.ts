// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
import { createAssistantToolBundle, prepareAssistantCliPrompt, prepareAssistantCliRequest } from "../assistant-tool-bundle";

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

  it("prepares only current-message text attachments with concurrent request isolation", async () => {
    const attachmentRoot = await root();
    await fs.writeFile(path.join(attachmentRoot, "2026-07/files/first.txt"), "FIRST_CANARY");
    await fs.writeFile(path.join(attachmentRoot, "2026-07/files/second.txt"), "SECOND_CANARY");
    await fs.writeFile(path.join(attachmentRoot, "2026-07/files/data.json"), '{"value":"JSON_CANARY"}');

    const [first, second, json] = await Promise.all([
      prepareAssistantCliPrompt({
        prompt: "first",
        attachmentRoot,
        attachments: ["2026-07/files/first.txt"],
      }),
      prepareAssistantCliPrompt({
        prompt: "second",
        attachmentRoot,
        attachments: ["2026-07/files/second.txt"],
      }),
      prepareAssistantCliPrompt({
        prompt: "json",
        attachmentRoot,
        attachments: ["2026-07/files/data.json"],
      }),
    ]);

    expect(first).toContain("FIRST_CANARY");
    expect(first).not.toContain("SECOND_CANARY");
    expect(first).toContain(path.join(attachmentRoot, "2026-07/files/first.txt"));
    expect(first).toContain("include these exact paths in references");
    expect(second).toContain("SECOND_CANARY");
    expect(second).not.toContain("FIRST_CANARY");
    expect(json).toContain("JSON_CANARY");
  });

  it("rejects CLI attachment traversal, realpath escapes, oversized data, and unsupported MIME", async () => {
    const attachmentRoot = await root();
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-outside-"));
    roots.push(outsideRoot);
    await fs.writeFile(path.join(outsideRoot, "secret.txt"), "secret");
    await fs.symlink(path.join(outsideRoot, "secret.txt"), path.join(attachmentRoot, "2026-07/files/link.txt"));
    await fs.writeFile(path.join(attachmentRoot, "2026-07/files/large.txt"), "12345");
    await fs.writeFile(path.join(attachmentRoot, "2026-07/files/binary.txt"), Buffer.from([0, 1, 2]));
    await fs.writeFile(
      path.join(attachmentRoot, "2026-07/files/image.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    );

    const cases = [
      { attachments: ["../secret.txt"] },
      { attachments: ["2026-07/files/link.txt"] },
      { attachments: ["2026-07/files/large.txt"], maxAttachmentBytes: 4 },
      { attachments: ["2026-07/files/binary.txt"] },
    ];
    for (const options of cases) {
      await expect(prepareAssistantCliPrompt({ prompt: "test", attachmentRoot, ...options }))
        .rejects.toMatchObject({ code: "tool_error", message: "A tool execution failed" });
    }

    const image = await prepareAssistantCliRequest({
      prompt: "inspect",
      attachmentRoot,
      attachments: ["2026-07/files/image.png"],
    });
    expect(image.attachments).toEqual([expect.objectContaining({
      filename: "2026-07/files/image.png",
      mediaType: "image/png",
      dataBase64: expect.any(String),
    })]);
    const realAttachmentRoot = await fs.realpath(attachmentRoot);
    expect(image.attachments[0]!.path.startsWith(realAttachmentRoot)).toBe(true);
    expect(image.prompt).toContain(image.attachments[0]!.path);
    expect(image.prompt).toContain("include these exact paths in references");
  });
});
