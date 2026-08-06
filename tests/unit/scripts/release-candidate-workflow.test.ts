import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  needs?: string | string[];
  outputs?: Record<string, string>;
  if?: string;
  environment?: string | Record<string, unknown>;
  permissions?: Record<string, string>;
  strategy?: {
    "fail-fast"?: boolean;
    matrix?: { include?: Array<Record<string, string>> };
  };
  steps: WorkflowStep[];
}

interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

const projectRoot = path.join(import.meta.dirname, "../../..");

function workflow(name: string): Workflow {
  return parse(readFileSync(path.join(projectRoot, ".github", "workflows", name), "utf8")) as Workflow;
}

function stepsUsing(job: WorkflowJob, action: string): WorkflowStep[] {
  return job.steps.filter((step) => step.uses === action);
}

function collectStrings(value: unknown, result: string[] = []): string[] {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, result));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => {
      result.push(key);
      collectStrings(entry, result);
    });
  }
  return result;
}

describe("Release Candidate workflow", () => {
  const candidate = workflow("release-candidate.yml");
  const release = workflow("release.yml");

  it("is manually dispatched with read-only repository permissions", () => {
    expect(candidate.on).toHaveProperty("workflow_dispatch");
    expect(candidate.on?.workflow_dispatch).toHaveProperty("inputs.source_ref");
    expect(candidate.permissions).toEqual({ contents: "read" });
    expect(candidate.jobs).toHaveProperty("prepare");
    expect(candidate.jobs).toHaveProperty("portable");
    expect(candidate.jobs).toHaveProperty("assemble");
  });

  it("automatically starts production only for stable semantic-version tags", () => {
    expect(release.on?.push).toEqual({ tags: ["v[0-9]+.[0-9]+.[0-9]+"] });
    expect(release.on).toHaveProperty("workflow_dispatch");
    expect(release.jobs.prepare.outputs).toEqual({
      tag: "${{ steps.identity.outputs.tag }}",
      confirmation: "${{ steps.identity.outputs.confirmation }}",
    });
    const identity = release.jobs.prepare.steps.find((step) => step.id === "identity");
    expect(identity?.run).toContain('if [ "$GITHUB_EVENT_NAME" = "push" ]');
    expect(identity?.run).toContain('tag="$GITHUB_REF_NAME"');
  });

  it("resolves the selected pushed ref once and pins every build job to its commit", () => {
    const prepareCheckout = candidate.jobs.prepare.steps.find((step) => step.uses === "actions/checkout@v4");
    const portableCheckout = candidate.jobs.portable.steps.find((step) => step.uses === "actions/checkout@v4");
    const assembleCheckout = candidate.jobs.assemble.steps.find((step) => step.uses === "actions/checkout@v4");
    expect(prepareCheckout?.with?.ref).toBe("${{ inputs.source_ref || github.ref }}");
    expect(portableCheckout?.with?.ref).toBe("${{ needs.prepare.outputs.commit }}");
    expect(assembleCheckout?.with?.ref).toBe("${{ needs.prepare.outputs.commit }}");
    expect(candidate.jobs.prepare.steps.find((step) => step.id === "identity")?.run).toContain("git rev-parse HEAD");
  });

  it("uses the exact five-target production matrix and keeps matrix failures independent", () => {
    const expected = [
      { platform: "darwin", arch: "arm64", runner: "macos-14", artifact: "tower-macos-arm64" },
      { platform: "darwin", arch: "x64", runner: "macos-15-intel", artifact: "tower-macos-x64" },
      { platform: "linux", arch: "x64", runner: "ubuntu-24.04", artifact: "tower-linux-x64" },
      { platform: "linux", arch: "arm64", runner: "ubuntu-24.04-arm", artifact: "tower-linux-arm64" },
      { platform: "windows", arch: "x64", runner: "windows-2022", artifact: "tower-windows-x64" },
    ];
    const candidateMatrix = candidate.jobs.portable.strategy?.matrix?.include;
    const productionMatrix = release.jobs.portable.strategy?.matrix?.include;
    expect(candidateMatrix).toEqual(expected);
    expect(candidateMatrix).toEqual(productionMatrix);
    expect(candidate.jobs.portable.strategy?.["fail-fast"]).toBe(false);
  });

  it("builds with the production scripts and smokes Node 22 and 24 after blocking downloads", () => {
    const prepareCommands = candidate.jobs.prepare.steps.flatMap((step) => step.run ? [step.run] : []);
    const steps = candidate.jobs.portable.steps;
    const build = steps.find((step) => step.name === "Build native portable payload");
    const releaseBuild = release.jobs.portable.steps.find((step) => step.name === "Build native portable payload");
    const smokes = steps.filter((step) => step.run?.includes("scripts/release-portable-smoke.js"));
    const nodeVersions = stepsUsing(candidate.jobs.portable, "actions/setup-node@v4")
      .map((step) => step.with?.["node-version"]);
    const blocks = steps.filter((step) => step.name?.startsWith("Block npm"));
    expect(prepareCommands).toContain("pnpm release:prepare");
    expect(prepareCommands.some((command) => command.includes("npm pack --pack-destination"))).toBe(true);
    expect(build?.run).toContain("scripts/build-portable-release.js");
    expect(releaseBuild?.run).toBe(build?.run);
    expect(smokes.map((step) => step.name)).toEqual([
      "Offline smoke on Node.js 22",
      "Offline smoke on Node.js 24",
    ]);
    expect(nodeVersions).toEqual([22, 24]);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.run).toContain("registry.npmjs.org");
      expect(block.run).toContain("binaries.prisma.sh");
    }
  });

  it("uploads only raw npm and separate per-platform artifacts with seven-day retention", () => {
    const prepareUploads = stepsUsing(candidate.jobs.prepare, "actions/upload-artifact@v4");
    const portableUploads = stepsUsing(candidate.jobs.portable, "actions/upload-artifact@v4");
    const assembleUploads = stepsUsing(candidate.jobs.assemble, "actions/upload-artifact@v4");
    const productionPortableUploads = stepsUsing(release.jobs.portable, "actions/upload-artifact@v4");
    const productionAssembleUploads = stepsUsing(release.jobs.assemble, "actions/upload-artifact@v4");
    expect(prepareUploads).toHaveLength(1);
    expect(prepareUploads[0].with?.name).toBe("tower-npm-pack-${{ steps.identity.outputs.short-sha }}");
    expect(stepsUsing(release.jobs.prepare, "actions/upload-artifact@v4")[0].with?.name)
      .toBe("tower-npm-pack-${{ steps.identity.outputs.tag }}");
    for (const workflowJob of [candidate.jobs.portable, candidate.jobs.assemble]) {
      const npmDownloads = stepsUsing(workflowJob, "actions/download-artifact@v4")
        .filter((step) => step.with?.name === "tower-npm-pack-${{ needs.prepare.outputs.short-sha }}");
      expect(npmDownloads).toHaveLength(1);
    }
    for (const workflowJob of [release.jobs.portable, release.jobs.assemble, release.jobs.publish]) {
      const npmDownloads = stepsUsing(workflowJob, "actions/download-artifact@v4")
        .filter((step) => step.with?.name === "tower-npm-pack-${{ needs.prepare.outputs.tag }}");
      expect(npmDownloads).toHaveLength(1);
    }
    expect(portableUploads).toHaveLength(1);
    expect(assembleUploads).toHaveLength(0);
    expect(productionAssembleUploads).toHaveLength(0);
    for (const upload of [...prepareUploads, ...portableUploads]) {
      expect(upload.with?.["retention-days"]).toBeGreaterThanOrEqual(7);
      expect(upload.with?.["if-no-files-found"]).toBe("error");
    }
    expect(portableUploads[0].with?.name).toBe("${{ matrix.artifact }}");
    expect(productionPortableUploads[0].with?.name).toBe("${{ matrix.artifact }}");
    expect(candidate.jobs.portable.strategy?.matrix?.include?.map((entry) => entry.artifact)).toEqual([
      "tower-macos-arm64",
      "tower-macos-x64",
      "tower-linux-x64",
      "tower-linux-arm64",
      "tower-windows-x64",
    ]);
    expect(candidate.jobs.portable.steps.indexOf(portableUploads[0]))
      .toBeGreaterThan(candidate.jobs.portable.steps.findIndex((step) => step.name === "Offline smoke on Node.js 24"));
  });

  it("downloads platform artifacts without matching the npm validation pack", () => {
    for (const workflowJob of [candidate.jobs.assemble, release.jobs.assemble, release.jobs.publish]) {
      const patterns = stepsUsing(workflowJob, "actions/download-artifact@v4")
        .flatMap((step) => typeof step.with?.pattern === "string" ? [step.with.pattern] : []);
      expect(patterns).toEqual(["tower-macos-*", "tower-linux-*", "tower-windows-*"]);
      expect(patterns).not.toContain("tower-*");
    }
  });

  it("assembles only after every matrix target succeeds and includes Candidate metadata", () => {
    expect(candidate.jobs.assemble.needs).toEqual(["prepare", "portable"]);
    expect(candidate.jobs.assemble.if).toBeUndefined();
    const assemble = candidate.jobs.assemble.steps.find((step) => step.name === "Assemble Candidate assets");
    expect(assemble?.run).toContain("scripts/assemble-release-assets.js");
    expect(assemble?.run).toContain("--candidate-ref");
    expect(assemble?.run).toContain("--dispatch-ref");
    expect(assemble?.run).toContain("--run-id");
    expect(assemble?.run).toContain("--run-attempt");
    expect(assemble?.run).toContain("--generated-at");
    expect(assemble?.env?.CANDIDATE_REF).toBe("${{ needs.prepare.outputs.source-ref }}");
    expect(assemble?.run).toContain('--candidate-ref "$CANDIDATE_REF"');
    expect(assemble?.run).not.toContain('${{ needs.prepare.outputs.source-ref }}');
  });

  it("requires exactly one npm tarball before production publication", () => {
    const locate = release.jobs.publish.steps.find((step) => step.name === "Locate the exact npm pack artifact");
    const publish = release.jobs.publish.steps.find((step) => step.name === "Publish or verify npm package with provenance");
    const assemble = release.jobs.publish.steps.find((step) => step.name === "Reassemble verified release assets");
    expect(assemble?.run).toContain("scripts/assemble-release-assets.js");
    expect(locate?.run).toContain('tarballs=("$RUNNER_TEMP"/release-input/npm-pack/*.tgz)');
    expect(locate?.run).toContain('${#tarballs[@]}');
    expect(publish?.run).toContain('${{ steps.npm-tarball.outputs.path }}');
    expect(publish?.run).not.toContain("basename");
  });

  it("does not rebuild after production approval", () => {
    expect(release.jobs.publish.needs).toEqual(["prepare", "assemble"]);
    expect(release.jobs.publish.environment).toBe("npm-production");
    const publishText = collectStrings(release.jobs.publish).join("\n");
    expect(publishText).not.toMatch(/pnpm install|playwright install|release:prepare/);
    expect(publishText).toContain("scripts/release.sh --publish --tarball");
  });

  it("contains no publication authority, environment, secret, or command", () => {
    for (const job of Object.values(candidate.jobs)) {
      expect(job.permissions).toBeUndefined();
      expect(job.environment).toBeUndefined();
      for (const step of job.steps) {
        expect(Object.keys(step.env ?? {})).not.toContain("NPM_TOKEN");
      }
    }
    const workflowText = collectStrings(candidate).join("\n");
    expect(workflowText).not.toMatch(/contents:\s*write|id-token:\s*write/i);
    expect(workflowText).not.toMatch(/npm-production|NPM_TOKEN|secrets\./i);
    expect(workflowText).not.toMatch(/npm\s+publish|gh\s+release|git\s+(?:tag|push)|release\.sh[^\n]*--publish|publish-github-release/i);
    expect(workflowText).not.toContain("0.4.0");
  });
});
