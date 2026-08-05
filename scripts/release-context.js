#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Release identity gate. */
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const pkg = require(path.join(__dirname, "..", "package.json"));
const projectRoot = path.join(__dirname, "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function assertReleaseContext(input) {
  const errors = [];
  const expectedTag = `v${input.version}`;
  const expectedConfirmation = `${input.packageName}@${input.version}`;
  const expectedRef = `refs/tags/${expectedTag}`;
  if (input.tag !== expectedTag) errors.push(`tag must be ${expectedTag}, got ${input.tag || "none"}`);
  if (input.confirmation !== expectedConfirmation) {
    errors.push(`confirmation must be ${expectedConfirmation}, got ${input.confirmation || "none"}`);
  }
  if (!/^[0-9a-f]{40}$/.test(input.head || "")) errors.push("HEAD must be a full Git commit SHA");
  if (input.tagCommit !== input.head) errors.push(`tag ${input.tag} resolves to ${input.tagCommit}, not HEAD ${input.head}`);
  if (input.workflowSha && input.workflowSha !== input.head) {
    errors.push(`workflow SHA ${input.workflowSha} does not match release HEAD ${input.head}`);
  }
  if (input.workflowDefinitionSha && input.workflowDefinitionSha !== input.head) {
    errors.push(`workflow definition SHA ${input.workflowDefinitionSha} does not match release HEAD ${input.head}`);
  }
  if (input.ref && input.ref !== expectedRef) {
    errors.push(`workflow ref must be ${expectedRef}, got ${input.ref}`);
  }
  if (input.releaseCommit && input.releaseCommit !== input.head) {
    errors.push(`release commit ${input.releaseCommit} does not match release HEAD ${input.head}`);
  }
  if (errors.length) throw new Error(`Release context gate failed:\n- ${errors.join("\n- ")}`);
  return { tag: expectedTag, commit: input.head, packageSpec: expectedConfirmation };
}

function git(args) {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
}

function main() {
  const tag = option("--tag", process.env.TOWER_RELEASE_TAG);
  const confirmation = option("--confirmation", process.env.TOWER_RELEASE_APPROVED);
  const result = assertReleaseContext({
    packageName: pkg.name,
    version: pkg.version,
    tag,
    confirmation,
    head: git(["rev-parse", "HEAD"]),
    tagCommit: tag ? git(["rev-list", "-n", "1", tag]) : "",
    workflowSha: option("--workflow-sha", process.env.GITHUB_SHA),
    workflowDefinitionSha: option("--workflow-definition-sha", process.env.GITHUB_WORKFLOW_SHA),
    ref: option("--ref", process.env.GITHUB_REF),
    releaseCommit: option("--release-commit", process.env.TOWER_RELEASE_COMMIT),
  });
  console.log(`[release:context] ${result.packageSpec} ${result.tag} ${result.commit}`);
}

module.exports = { assertReleaseContext };
if (require.main === module) main();
