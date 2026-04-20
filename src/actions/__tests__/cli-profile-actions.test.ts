import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    cliProfile: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  getDefaultCliProfile,
  updateCliProfile,
} from "@/actions/cli-profile-actions";

const mockDb = db as {
  cliProfile: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;

const mockProfile = {
  id: "profile1",
  name: "Default",
  command: "claude",
  baseArgs: '["--model","claude-3-5-sonnet"]',
  envVars: '{"MY_VAR":"value"}',
  isDefault: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDefaultCliProfile", () => {
  it("returns shaped profile when found", async () => {
    mockDb.cliProfile.findFirst.mockResolvedValue(mockProfile);

    const result = await getDefaultCliProfile();

    expect(mockDb.cliProfile.findFirst).toHaveBeenCalledWith({
      where: { isDefault: true },
    });
    expect(result).toEqual({
      id: "profile1",
      name: "Default",
      command: "claude",
      baseArgs: '["--model","claude-3-5-sonnet"]',
      envVars: '{"MY_VAR":"value"}',
    });
  });

  it("returns null when no default profile exists", async () => {
    mockDb.cliProfile.findFirst.mockResolvedValue(null);

    const result = await getDefaultCliProfile();

    expect(result).toBeNull();
  });
});

describe("updateCliProfile — command validation", () => {
  it("happy path: valid command 'claude' passes and calls update", async () => {
    mockDb.cliProfile.update.mockResolvedValue(mockProfile);

    await updateCliProfile("profile1", {
      command: "claude",
      baseArgs: '["--model","opus"]',
      envVars: '{"FOO":"bar"}',
    });

    expect(mockDb.cliProfile.update).toHaveBeenCalledWith({
      where: { id: "profile1" },
      data: expect.objectContaining({ command: "claude" }),
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("valid command 'claude-code' passes", async () => {
    mockDb.cliProfile.update.mockResolvedValue({ ...mockProfile, command: "claude-code" });

    await expect(
      updateCliProfile("profile1", { command: "claude-code" })
    ).resolves.not.toThrow();
    expect(mockDb.cliProfile.update).toHaveBeenCalled();
  });

  it("command with path prefix: '/usr/bin/claude' basename is 'claude' — passes allowlist", async () => {
    mockDb.cliProfile.update.mockResolvedValue(mockProfile);

    await expect(
      updateCliProfile("profile1", { command: "/usr/bin/claude" })
    ).resolves.not.toThrow();
    expect(mockDb.cliProfile.update).toHaveBeenCalled();
  });

  it("command 'bash' is not in allowlist — throws error", async () => {
    await expect(
      updateCliProfile("profile1", { command: "bash" })
    ).rejects.toThrow(/claude.*claude-code|claude-code.*claude/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("command 'sh' is not in allowlist — throws error", async () => {
    await expect(
      updateCliProfile("profile1", { command: "sh" })
    ).rejects.toThrow();
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });
});

describe("updateCliProfile — baseArgs validation", () => {
  it("valid baseArgs JSON array of strings passes", async () => {
    mockDb.cliProfile.update.mockResolvedValue(mockProfile);

    await expect(
      updateCliProfile("profile1", { baseArgs: '["--model","opus"]' })
    ).resolves.not.toThrow();
    expect(mockDb.cliProfile.update).toHaveBeenCalled();
  });

  it("invalid JSON string throws about JSON array", async () => {
    await expect(
      updateCliProfile("profile1", { baseArgs: "not json" })
    ).rejects.toThrow(/JSON 数组|JSON array/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("non-array JSON (string) throws about JSON array", async () => {
    await expect(
      updateCliProfile("profile1", { baseArgs: '"string"' })
    ).rejects.toThrow(/JSON 数组|JSON array/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("baseArgs with shell metacharacter ';' throws about disallowed characters", async () => {
    await expect(
      updateCliProfile("profile1", { baseArgs: '["--flag;rm -rf"]' })
    ).rejects.toThrow(/不允许的字符|disallowed/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("baseArgs with metacharacter '|' throws", async () => {
    await expect(
      updateCliProfile("profile1", { baseArgs: '["--flag|evil"]' })
    ).rejects.toThrow();
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("baseArgs with metacharacter '`' throws", async () => {
    await expect(
      updateCliProfile("profile1", { baseArgs: '["--flag`cmd`"]' })
    ).rejects.toThrow();
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("non-string element in baseArgs array throws", async () => {
    await expect(
      updateCliProfile("profile1", { baseArgs: "[123]" })
    ).rejects.toThrow(/字符串|string/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });
});

describe("updateCliProfile — envVars validation", () => {
  it("valid envVars JSON object passes", async () => {
    mockDb.cliProfile.update.mockResolvedValue(mockProfile);

    await expect(
      updateCliProfile("profile1", { envVars: '{"MY_VAR":"hello"}' })
    ).resolves.not.toThrow();
    expect(mockDb.cliProfile.update).toHaveBeenCalled();
  });

  it("invalid JSON throws about JSON object", async () => {
    await expect(
      updateCliProfile("profile1", { envVars: "not json" })
    ).rejects.toThrow(/JSON 对象|JSON object/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("JSON array throws about JSON object", async () => {
    await expect(
      updateCliProfile("profile1", { envVars: "[]" })
    ).rejects.toThrow(/JSON 对象|JSON object/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("blocked key PATH (uppercase) throws about system critical variable", async () => {
    await expect(
      updateCliProfile("profile1", { envVars: '{"PATH":"/evil"}' })
    ).rejects.toThrow(/系统关键变量|PATH/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("blocked key NODE_OPTIONS throws", async () => {
    await expect(
      updateCliProfile("profile1", { envVars: '{"NODE_OPTIONS":"--inspect"}' })
    ).rejects.toThrow(/系统关键变量|NODE_OPTIONS/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("blocked key LD_PRELOAD throws", async () => {
    await expect(
      updateCliProfile("profile1", { envVars: '{"LD_PRELOAD":"/evil.so"}' })
    ).rejects.toThrow();
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });

  it("blocked key lowercase 'path' also throws (toUpperCase normalization)", async () => {
    await expect(
      updateCliProfile("profile1", { envVars: '{"path":"/evil"}' })
    ).rejects.toThrow(/系统关键变量|path/);
    expect(mockDb.cliProfile.update).not.toHaveBeenCalled();
  });
});

describe("updateCliProfile — P2025 error handling", () => {
  it("P2025 Prisma error returns user-friendly message '不存在'", async () => {
    mockDb.cliProfile.update.mockRejectedValue({ code: "P2025" });

    await expect(
      updateCliProfile("profile1", { command: "claude" })
    ).rejects.toThrow(/CLI Profile 不存在/);
  });

  it("non-P2025 errors are re-thrown as-is", async () => {
    const originalError = new Error("Database connection failed");
    mockDb.cliProfile.update.mockRejectedValue(originalError);

    await expect(
      updateCliProfile("profile1", { command: "claude" })
    ).rejects.toThrow("Database connection failed");
  });
});
