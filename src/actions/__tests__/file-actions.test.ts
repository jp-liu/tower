import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted lifts mock declarations above the vi.mock calls so the inline
// factories below can capture them (vitest evaluates vi.mock() before imports).
const mockReadFile = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockOpen = vi.hoisted(() => vi.fn());

vi.mock("fs/promises", () => {
  const fns = {
    readdir: vi.fn(),
    readFile: mockReadFile,
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    rm: vi.fn(),
    unlink: vi.fn(),
    stat: mockStat,
    open: mockOpen,
  };
  return { default: fns, ...fns };
});

vi.mock("fs", () => {
  const fns = { existsSync: vi.fn(() => false) };
  return { default: fns, ...fns };
});

vi.mock("@/lib/fs-security", () => ({
  safeResolvePath: (root: string, rel: string) => `${root}/${rel}`,
}));

vi.mock("@/actions/config-actions", () => ({
  getConfigValue: vi.fn(async (_key: string, def: number) => def),
}));

import { readFileContent, readFileContentForce } from "@/actions/file-actions";
import { getConfigValue } from "@/actions/config-actions";

/**
 * Build a fake FileHandle that copies the given source buffer into the target
 * buffer passed to read(). Mimics the actual fh.read(sniff, 0, sniffSize, 0).
 */
function mockFileHandle(buf: Buffer) {
  return {
    read: vi.fn(async (target: Buffer, offset: number, length: number) => {
      const copied = buf.copy(target, offset, 0, length);
      return { bytesRead: copied };
    }),
    close: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default getConfigValue resolves to the provided default; individual tests
  // can override via mockResolvedValueOnce when needed.
  (getConfigValue as ReturnType<typeof vi.fn>).mockImplementation(
    async (_key: string, def: number) => def
  );
});

describe("readFileContent kinds", () => {
  it("returns kind=text for small UTF-8 file", async () => {
    const text = "hello world";
    mockStat.mockResolvedValue({ size: text.length });
    mockOpen.mockResolvedValue(mockFileHandle(Buffer.from(text, "utf-8")));
    mockReadFile.mockResolvedValue(text);

    const result = await readFileContent("/wt", "a.txt");

    expect(result).toEqual({ kind: "text", content: text, size: text.length });
    expect(mockReadFile).toHaveBeenCalledWith("/wt/a.txt", "utf-8");
  });

  it("returns kind=oversized when size > limit and does not read content", async () => {
    mockStat.mockResolvedValue({ size: 6_000_000 });

    const result = await readFileContent("/wt", "big.bin");

    expect(result).toEqual({ kind: "oversized", size: 6_000_000, limit: 5_242_880 });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("returns kind=binary when NUL byte found in first 8KB", async () => {
    const buf = Buffer.alloc(200, 0x41); // fill with 'A'
    buf[100] = 0; // single NUL byte in the first 8KB
    mockStat.mockResolvedValue({ size: 200 });
    mockOpen.mockResolvedValue(mockFileHandle(buf));

    const result = await readFileContent("/wt", "x.bin");

    expect(result).toEqual({ kind: "binary", size: 200 });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("honors a configured limit override from getConfigValue", async () => {
    (getConfigValue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1024);
    mockStat.mockResolvedValue({ size: 2048 });

    const result = await readFileContent("/wt", "med.txt");

    expect(result).toEqual({ kind: "oversized", size: 2048, limit: 1024 });
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("returns kind=text for a clean file just under the limit", async () => {
    const fileSize = 5_242_870; // 10 bytes under 5 MiB
    // Source buffer must be at least sniff window (8192 bytes) of non-NUL data
    // so the binary sniff sees only printable bytes.
    const sniffSource = Buffer.alloc(8192, 0x41); // filled with 'A'
    const fullContent = "a".repeat(fileSize);
    mockStat.mockResolvedValue({ size: fileSize });
    mockOpen.mockResolvedValue(mockFileHandle(sniffSource));
    mockReadFile.mockResolvedValue(fullContent);

    const result = await readFileContent("/wt", "near-limit.txt");

    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.content).toBe(fullContent);
      expect(result.size).toBe(fileSize);
    }
  });
});

describe("readFileContentForce", () => {
  it("returns content even when file is oversized", async () => {
    mockStat.mockResolvedValue({ size: 10_000_000 });
    mockReadFile.mockResolvedValue("forced content");

    const result = await readFileContentForce("/wt", "big.txt");

    expect(result).toEqual({ content: "forced content", size: 10_000_000 });
    expect(mockReadFile).toHaveBeenCalledWith("/wt/big.txt", "utf-8");
  });

  it("returns content for binary files (caller accepts garbling)", async () => {
    mockStat.mockResolvedValue({ size: 200 });
    mockReadFile.mockResolvedValue("garbled bytes");

    const result = await readFileContentForce("/wt", "x.bin");

    expect(result.content).toContain("garbled");
    expect(result.size).toBe(200);
    // Force-open never sniffs, so open() must not be called
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
