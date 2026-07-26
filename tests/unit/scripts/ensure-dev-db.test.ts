import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolvePackageBin } = require("../../../scripts/ensure-dev-db.js");

describe("ensure-dev-db", () => {
  it("resolves JavaScript package entrypoints instead of pnpm shell shims", () => {
    const prismaBin = resolvePackageBin("prisma", "prisma");
    const tsxBin = resolvePackageBin("tsx", "tsx");

    expect(prismaBin).toMatch(/prisma[/\\]build[/\\]index\.js$/);
    expect(tsxBin).toMatch(/tsx[/\\]dist[/\\]cli\.mjs$/);
    expect(path.normalize(prismaBin)).not.toContain(`${path.sep}.bin${path.sep}`);
    expect(path.normalize(tsxBin)).not.toContain(`${path.sep}.bin${path.sep}`);
  });
});
