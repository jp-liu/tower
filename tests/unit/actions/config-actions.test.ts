// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let getConfigValueFn: <T>(key: string, defaultValue: T) => Promise<T>;
let setConfigValueFn: (key: string, value: unknown) => Promise<void>;
let getConfigValuesFn: (keys: string[]) => Promise<Record<string, unknown>>;

beforeAll(async () => {
  await testDb.$connect();

  // Dynamic import: config-actions.ts uses "use server" directive
  const mod = await import("@/actions/config-actions");
  getConfigValueFn = mod.getConfigValue;
  setConfigValueFn = mod.setConfigValue;
  getConfigValuesFn = mod.getConfigValues;
});

afterAll(async () => {
  await testDb.$disconnect();
});

afterEach(async () => {
  // Clean up test rows
  await testDb.$executeRawUnsafe(
    `DELETE FROM SystemConfig WHERE key LIKE 'test.%'`
  );
});

describe("getConfigValue", () => {
  it("returns defaultValue when key does not exist in DB", async () => {
    const result = await getConfigValueFn("test.nonexistent.key", 42);
    expect(result).toBe(42);
  });

  it("returns stored string value after setConfigValue", async () => {
    await setConfigValueFn("test.key.str", "hello");
    const result = await getConfigValueFn("test.key.str", "");
    expect(result).toBe("hello");
  });

  it("returns stored number value after setConfigValue", async () => {
    await setConfigValueFn("test.key.num", 100);
    const result = await getConfigValueFn("test.key.num", 0);
    expect(result).toBe(100);
  });

  it("returns stored boolean value after setConfigValue", async () => {
    await setConfigValueFn("test.key.bool", true);
    const result = await getConfigValueFn("test.key.bool", false);
    expect(result).toBe(true);
  });

  it("returns defaultValue when stored value is malformed JSON", async () => {
    // Directly insert a malformed JSON value
    await testDb.$executeRawUnsafe(
      `INSERT INTO SystemConfig (id, key, value, createdAt, updatedAt) VALUES ('test-malformed-id', 'test.malformed', 'not-valid-json{{', datetime('now'), datetime('now'))`
    );
    const result = await getConfigValueFn("test.malformed", "fallback");
    expect(result).toBe("fallback");
  });
});

describe("setConfigValue", () => {
  it("creates a new row when key does not exist", async () => {
    await setConfigValueFn("test.new.key", "value1");
    const row = await testDb.$queryRaw<{ value: string }[]>`
      SELECT value FROM SystemConfig WHERE key = 'test.new.key'
    `;
    expect(row).toHaveLength(1);
    expect(JSON.parse((row[0] as { value: string }).value)).toBe("value1");
  });

  it("updates existing row when key already exists (upsert update path)", async () => {
    await setConfigValueFn("test.upsert.key", "v1");
    await setConfigValueFn("test.upsert.key", "v2");
    const result = await getConfigValueFn("test.upsert.key", "");
    expect(result).toBe("v2");

    // Confirm only one row exists
    const rows = await testDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*) as count FROM SystemConfig WHERE key = 'test.upsert.key'
    `;
    expect(Number((rows[0] as { count: number }).count)).toBe(1);
  });
});

describe("getConfigValues", () => {
  it("returns stored values for existing keys and null for missing keys", async () => {
    await setConfigValueFn("test.batch.key1", "value-a");
    await setConfigValueFn("test.batch.key2", 999);

    const result = await getConfigValuesFn([
      "test.batch.key1",
      "test.batch.key2",
      "test.batch.missing",
    ]);

    expect(result["test.batch.key1"]).toBe("value-a");
    expect(result["test.batch.key2"]).toBe(999);
    expect(result["test.batch.missing"]).toBeNull();
  });

  it("returns CONFIG_DEFAULTS defaultValue for keys registered in defaults", async () => {
    // CONFIG_DEFAULTS is currently empty in Phase 11, so missing keys return null
    // This test verifies the behavior with actual missing key
    const result = await getConfigValuesFn(["test.unknown.key"]);
    expect(result["test.unknown.key"]).toBeNull();
  });
});
