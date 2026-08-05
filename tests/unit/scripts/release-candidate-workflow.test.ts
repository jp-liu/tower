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
      { platform: "darwin", arch: "arm64", runner: "macos-14" },
      { platform: "darwin", arch: "x64", runner: "macos-15-intel" },
      { platform: "linux", arch: "x64", runner: "ubuntu-24.04" },
      { platform: "linux", arch: "arm64", runner: "ubuntu-24.04-arm" },
      { platform: "windows", arch: "x64", runner: "windows-2022" },
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
    const smokes = steps.filter((step) => step.run?.includes("scripts/release-portable-smoke.js"));
    const nodeVersions = stepsUsing(candidate.jobs.portable, "actions/setup-node@v4")
      .map((step) => step.with?.["node-version"]);
    const blocks = steps.filter((step) => step.name?.startsWith("Block npm"));
    expect(prepareCommands).toContain("pnpm release:prepare");
    expect(prepareCommands.some((command) => command.includes("npm pack --pack-destination"))).toBe(true);
    expect(build?.run).toContain("scripts/build-portable-release.js");
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

  it("uploads raw, per-platform, and all-platform artifacts with seven-day retention", () => {
    const prepareUploads = stepsUsing(candidate.jobs.prepare, "actions/upload-artifact@v4");
    const portableUploads = stepsUsing(candidate.jobs.portable, "actions/upload-artifact@v4");
    const assembleUploads = stepsUsing(candidate.jobs.assemble, "actions/upload-artifact@v4");
    expect(prepareUploads).toHaveLength(1);
    expect(portableUploads).toHaveLength(1);
    expect(assembleUploads).toHaveLength(1);
    for (const upload of [...prepareUploads, ...portableUploads, ...assembleUploads]) {
      expect(upload.with?.["retention-days"]).toBeGreaterThanOrEqual(7);
      expect(upload.with?.["if-no-files-found"]).toBe("error");
    }
    expect(portableUploads[0].with?.name).toContain("matrix.platform");
    expect(portableUploads[0].with?.name).toContain("matrix.arch");
    expect(candidate.jobs.portable.steps.indexOf(portableUploads[0]))
      .toBeGreaterThan(candidate.jobs.portable.steps.findIndex((step) => step.name === "Offline smoke on Node.js 24"));
    expect(assembleUploads[0].with?.name).toBe("tower-release-candidate-${{ needs.prepare.outputs.short-sha }}");
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
