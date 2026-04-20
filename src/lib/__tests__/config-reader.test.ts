// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted to define mock before vi.mock hoisting runs
const mockFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    systemConfig: {
      findUnique: mockFindUnique,
    },
  },
}));

import { readConfigValue } from "../config-reader";

describe("readConfigValue", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns default value when key is missing from DB (findUnique returns null)", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await readConfigValue("missing-key", 42);
    expect(result).toBe(42);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: "missing-key" } });
  });

  it("returns parsed number when findUnique returns valid JSON string '100'", async () => {
    mockFindUnique.mockResolvedValue({ value: "100" });
    const result = await readConfigValue<number>("number-key", 0);
    expect(result).toBe(100);
  });

  it("returns parsed string when findUnique returns valid JSON string '\"hello\"'", async () => {
    mockFindUnique.mockResolvedValue({ value: '"hello"' });
    const result = await readConfigValue<string>("string-key", "default");
    expect(result).toBe("hello");
  });

  it("returns parsed boolean true when findUnique returns value 'true'", async () => {
    mockFindUnique.mockResolvedValue({ value: "true" });
    const result = await readConfigValue<boolean>("bool-key", false);
    expect(result).toBe(true);
  });

  it("returns default value when stored JSON is invalid (fallback on parse error)", async () => {
    mockFindUnique.mockResolvedValue({ value: "not-json{" });
    const result = await readConfigValue<string>("bad-json", "fallback");
    expect(result).toBe("fallback");
  });

  it("returns parsed object when findUnique returns valid JSON object string", async () => {
    mockFindUnique.mockResolvedValue({ value: '{"a":1}' });
    const result = await readConfigValue<{ a: number }>("object-key", {});
    expect(result).toEqual({ a: 1 });
  });

  it("returns default object when findUnique returns null (complex default)", async () => {
    mockFindUnique.mockResolvedValue(null);
    const defaultVal = { nested: { x: 99 } };
    const result = await readConfigValue("missing-complex", defaultVal);
    expect(result).toEqual(defaultVal);
  });

  it("returns parsed boolean false when findUnique returns value 'false'", async () => {
    mockFindUnique.mockResolvedValue({ value: "false" });
    const result = await readConfigValue<boolean>("bool-false-key", true);
    expect(result).toBe(false);
  });
});
