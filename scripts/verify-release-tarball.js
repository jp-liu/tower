#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Release tarball verifier. */
const crypto = require("node:crypto");
const fs = require("node:fs");

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

function main() {
  const tarball = option("--tarball");
  const metadataPath = option("--metadata");
  const expectedName = option("--package");
  const expectedVersion = option("--version");
  const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const metadata = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!metadata || metadata.name !== expectedName || metadata.version !== expectedVersion) {
    throw new Error(
      `Tarball identity mismatch: expected ${expectedName}@${expectedVersion}, got ${metadata?.name || "unknown"}@${metadata?.version || "unknown"}`,
    );
  }

  const integrity = `sha512-${crypto.createHash("sha512").update(fs.readFileSync(tarball)).digest("base64")}`;
  if (metadata.integrity !== integrity) {
    throw new Error(`Tarball integrity mismatch: npm reported ${metadata.integrity || "missing"}`);
  }
  process.stdout.write(integrity);
}

if (require.main === module) main();
