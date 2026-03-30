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
let resolveGitLocalPathFn: (url: string) => Promise<string>;

beforeAll(async () => {
  await testDb.$connect();

  // Dynamic import: config-actions.ts uses "use server" directive
  const mod = await import("@/actions/config-actions");
  getConfigValueFn = mod.getConfigValue;
  setConfigValueFn = mod.setConfigValue;
  getConfigValuesFn = mod.getConfigValues;
  resolveGitLocalPathFn = mod.resolveGitLocalPath;
});

afterAll(async () => {
  await testDb.$disconnect();
});

afterEach(async () => {
  // Clean up test rows
  await testDb.$executeRawUnsafe(
    `DELETE FROM SystemConfig WHERE key LIKE 'test.%' OR key = 'git.pathMappingRules'`
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
    // git.pathMappingRules is in CONFIG_DEFAULTS with defaultValue: []
    const result = await getConfigValuesFn(["git.pathMappingRules"]);
    expect(result["git.pathMappingRules"]).toEqual([]);
  });
});

describe("resolveGitLocalPath", () => {
  it("returns empty string for empty URL input", async () => {
    const result = await resolveGitLocalPathFn("");
    expect(result).toBe("");
  });

  it("returns empty string for whitespace-only URL input", async () => {
    const result = await resolveGitLocalPathFn("   ");
    expect(result).toBe("");
  });

  it("falls back to hardcoded gitUrlToLocalPath when no rules in DB", async () => {
    // No rules stored, should use hardcoded logic for github.com/jp-liu
    const result = await resolveGitLocalPathFn("https://github.com/jp-liu/test-repo");
    // Hardcoded logic maps jp-liu → ~/project/i/{repo}
    expect(result).toContain("project/i/test-repo");
  });

  it("uses rule-based matching when matching rules exist in DB", async () => {
    const rules = [
      {
        id: "rule-1",
        host: "github.com",
        ownerMatch: "jp-liu",
        localPathTemplate: "~/custom/path/{repo}",
        priority: 0,
      },
    ];
    await setConfigValueFn("git.pathMappingRules", rules);

    const result = await resolveGitLocalPathFn("https://github.com/jp-liu/test-repo");
    const home = (await import("os")).default.homedir();
    expect(result).toBe(`${home}/custom/path/test-repo`);
  });

  it("falls back to hardcoded logic when no rule matches the URL", async () => {
    const rules = [
      {
        id: "rule-1",
        host: "gitlab.com",
        ownerMatch: "*",
        localPathTemplate: "~/gitlab/{repo}",
        priority: 0,
      },
    ];
    await setConfigValueFn("git.pathMappingRules", rules);

    // URL is github.com, rule is for gitlab.com — should fall back
    const result = await resolveGitLocalPathFn("https://github.com/jp-liu/test-repo");
    expect(result).toContain("project/i/test-repo");
  });
});
