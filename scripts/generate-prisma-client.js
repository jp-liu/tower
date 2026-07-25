#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This published postinstall helper must run as CommonJS in consumer installs. */
const { execFileSync } = require("child_process");
const path = require("path");

const packageRoot = path.join(__dirname, "..");

function resolvePrismaBin() {
  const pkgJsonPath = require.resolve("prisma/package.json", { paths: [packageRoot] });
  const pkgJson = require(pkgJsonPath);
  const binField = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.prisma;

  if (!binField) {
    throw new Error("No prisma bin entry found");
  }

  return path.resolve(path.dirname(pkgJsonPath), binField);
}

try {
  execFileSync(process.execPath, [resolvePrismaBin(), "generate", "--schema", "prisma/schema.prisma"], {
    cwd: packageRoot,
    stdio: "inherit",
    env: process.env,
  });
} catch (error) {
  console.warn(`[generate-prisma] Failed to generate Prisma client: ${error.message}`);
  process.exit(1);
}
